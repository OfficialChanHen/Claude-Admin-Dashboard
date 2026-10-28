import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { ACTIVE_WINDOW_MS, BUDGET } from './config.js'
import { all, get, run } from './db.js'
import { bus } from './bus.js'
import { getLimits, type Limits } from './limits.js'
import { listProjects } from './projects.js'
import { PERMISSION_MODES, runningPrompts, startPrompt, type PermissionMode } from './prompt.js'

// Keeps the 5 hour plan limit for you. Past the wrap-up mark, sessions are
// told (through the hooks) to finish the step they are on and stop; a little
// past that, new steps are refused. In the last half hour before the window
// resets, whatever is left would go to waste, so HQ uses it: it finishes the
// work it paused, then starts the prompts you queued for spare usage, one at a
// time and only while nothing else is running.

export type Phase = 'ok' | 'wrap' | 'stop'
export type Reading = { phase: Phase; spare: boolean; pct: number | null; resetsAt: number | null; window: string | null }
type Config = typeof BUDGET

const NONE: Reading = { phase: 'ok', spare: false, pct: null, resetsAt: null, window: null }

/** Where the 5 hour window stands right now. */
export function readBudget(fiveHour: Limits['fiveHour'] | undefined, now: number, cfg: Config = BUDGET): Reading {
  if (!cfg.on || !fiveHour) return NONE
  const resetsAt = fiveHour.resetsAt ? Date.parse(fiveHour.resetsAt) : NaN
  const known = Number.isFinite(resetsAt)
  // The numbers are for a window that has already reset.
  if (known && resetsAt <= now) return NONE
  const spare = known && resetsAt - now <= cfg.spareMs
  const pct = fiveHour.pct
  const phase: Phase = !cfg.guard ? 'ok' : pct >= (spare ? cfg.spareStopAt : cfg.stopAt) ? 'stop' : pct >= (spare ? cfg.spareWrapAt : cfg.wrapAt) ? 'wrap' : 'ok'
  // Sources round the reset time differently; a 10 minute bucket names the window.
  return { phase, spare, pct, resetsAt: known ? resetsAt : null, window: known ? String(Math.round(resetsAt / 600_000)) : 'unknown' }
}

type HookIn = { hook_event_name?: string; session_id?: string; prompt?: string }
export type HookReply = Record<string, unknown>

const pctText = (r: Reading) => `${Math.round(r.pct ?? 0)}%`

/** What the hooks tell each session. Kept in memory: a restart only forgets who was warned. */
export class Governor {
  private warned = new Map<string, string>()
  private passes = new Map<string, string>()
  private denials = new Map<string, number>()
  /** Sessions HQ started on spare usage. Their prompts never earn a pass. */
  readonly pilot = new Set<string>()

  constructor(private store: { pause(sessionId: string): void; takeOver(sessionId: string): void }) {}

  advise(p: HookIn, r: Reading): HookReply {
    const sid = p.session_id
    const ev = p.hook_event_name
    if (!sid || !ev) return {}
    const key = `${r.window}:${r.spare}`

    if (ev === 'UserPromptSubmit') {
      this.denials.delete(sid)
      // Prompts that start with a tag are Claude Code's own (task notices, wakeups), not you.
      const typed = !this.pilot.has(sid) && !(p.prompt ?? '').trimStart().startsWith('<')
      if (typed) this.store.takeOver(sid)
      if (r.phase === 'ok' || !typed) return {}
      // You asked for more past the limit, so this session is yours until the window resets.
      this.passes.set(sid, key)
      return context(ev, `HQ: the 5 hour plan limit is at ${pctText(r)}. The user asked for this anyway, so HQ will not pause it, but keep the work short.`)
    }

    if (r.phase === 'ok' || this.passes.get(sid) === key) return {}

    if (ev === 'PostToolUse' && this.warned.get(sid) !== key) {
      this.warned.set(sid, key)
      this.store.pause(sid)
      return context(
        ev,
        `HQ: the 5 hour plan limit is at ${pctText(r)}. Finish the step you are on, leave the work in a state that builds, and stop. If the task is not done, end with a short list of what is left so it can be picked up after the reset.`,
      )
    }

    if (ev === 'PreToolUse' && r.phase === 'stop') {
      this.store.pause(sid)
      const n = (this.denials.get(sid) ?? 0) + 1
      this.denials.set(sid, n)
      // It keeps trying: end the turn outright.
      if (n > 3) return { continue: false, stopReason: `HQ paused this session at ${pctText(r)} of the 5 hour limit.` }
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `HQ: the 5 hour plan limit is at ${pctText(r)}, so new steps are paused until it resets. Do not try other tools. Reply with what is done and what is left, then stop.`,
        },
      }
    }
    return {}
  }
}

function context(hookEventName: string, additionalContext: string): HookReply {
  return { hookSpecificOutput: { hookEventName, additionalContext } }
}

export const RESUME_TEXT =
  'HQ: you were paused at the 5 hour plan limit. There is usage left before it resets, so finish the task you were on. If it is already done, say so in one line and stop. Do not start anything new.'

/** Spare usage is spent only when the window is nearly over, numbers are fresh and nobody is working. */
export function canSpend(r: Reading, limits: Pick<Limits, 'fetchedAt'> | null, busy: boolean, now: number) {
  return r.spare && r.phase === 'ok' && !!limits && now - limits.fetchedAt < 10 * 60_000 && !busy
}

// ---- Wiring: the database, the timer and the API ----

const PAUSE_KEEP_MS = 24 * 3600_000

export const governor = new Governor({
  pause(sessionId) {
    const res = run(
      `INSERT INTO paused (session_id, project_id, paused_at) SELECT id, project_id, ? FROM sessions WHERE id = ?
       ON CONFLICT(session_id) DO UPDATE SET paused_at = excluded.paused_at, resumed_at = NULL WHERE resumed_at IS NOT NULL`,
      Date.now(), sessionId,
    )
    if (res.changes) bus.publish({ kind: 'budget' })
  },
  takeOver(sessionId) {
    const res = run('UPDATE paused SET resumed_at = ? WHERE session_id = ? AND resumed_at IS NULL', Date.now(), sessionId)
    if (res.changes) bus.publish({ kind: 'budget' })
  },
})

export function currentBudget(now = Date.now()) {
  return readBudget(getLimits()?.fiveHour, now)
}

export function adviseHook(p: HookIn) {
  return governor.advise(p, currentBudget())
}

function busy(now: number) {
  if (runningPrompts().length) return true
  return !!get(`SELECT 1 FROM sessions WHERE state IN ('working', 'waiting') AND last_at >= ? LIMIT 1`, now - ACTIVE_WINDOW_MS)
}

/** Starts the next piece of spare-usage work, if this is the time for it. */
export function spendSpare(now = Date.now()) {
  if (!canSpend(currentBudget(now), getLimits(), busy(now), now)) return null
  const projects = new Map(listProjects().map((p) => [p.id, p]))

  const paused = all<{ session_id: string; project_id: string | null }>(
    'SELECT session_id, project_id FROM paused WHERE resumed_at IS NULL AND paused_at >= ? ORDER BY paused_at',
    now - PAUSE_KEEP_MS,
  )
  for (const row of paused) {
    run('UPDATE paused SET resumed_at = ? WHERE session_id = ?', now, row.session_id)
    const project = row.project_id ? projects.get(row.project_id) : undefined
    if (!project || !fs.existsSync(project.path)) continue
    governor.pilot.add(row.session_id)
    startPrompt({ projectId: project.id, text: RESUME_TEXT, mode: 'continue', permissionMode: 'acceptEdits' }, project.path, row.session_id)
    bus.publish({ kind: 'budget' })
    return { resumed: row.session_id }
  }

  const queued = all<Queued>('SELECT id, project_id, text, permission_mode FROM queue WHERE started_at IS NULL ORDER BY added_at')
  for (const q of queued) {
    const sessionId = startQueued(q, projects, now)
    if (!sessionId) continue
    governor.pilot.add(sessionId)
    return { started: q.id }
  }
  return null
}

type Queued = { id: string; project_id: string; text: string; permission_mode: string }

/** Takes a task off the queue and starts it. A task whose project is gone is dropped. */
function startQueued(q: Queued, projects: Map<string, { id: string; path: string }>, now: number) {
  run('UPDATE queue SET started_at = ? WHERE id = ?', now, q.id)
  bus.publish({ kind: 'budget' })
  const project = projects.get(q.project_id)
  if (!project || !fs.existsSync(project.path)) return null
  const permissionMode = PERMISSION_MODES.includes(q.permission_mode as PermissionMode) ? (q.permission_mode as PermissionMode) : 'acceptEdits'
  return startPrompt({ projectId: project.id, text: q.text, mode: 'new', permissionMode }, project.path).sessionId
}

/**
 * Starts queued tasks now instead of waiting for spare usage: one, or all of
 * them when no id is given. You asked for it, so they are not HQ's pilots and
 * a prompt you type to them past the limit still runs.
 */
export function runQueued(id?: string, now = Date.now()) {
  const projects = new Map(listProjects().map((p) => [p.id, p]))
  const queued = id
    ? all<Queued>('SELECT id, project_id, text, permission_mode FROM queue WHERE id = ? AND started_at IS NULL', id)
    : all<Queued>('SELECT id, project_id, text, permission_mode FROM queue WHERE started_at IS NULL ORDER BY added_at')
  const started: string[] = []
  const missing: string[] = []
  for (const q of queued) (startQueued(q, projects, now) ? started : missing).push(q.id)
  return { found: queued.length, started, missing }
}

export function queuePrompt(projectId: string, text: string, permissionMode: PermissionMode) {
  const id = randomUUID()
  run('INSERT INTO queue (id, project_id, text, permission_mode, added_at) VALUES (?, ?, ?, ?, ?)', id, projectId, text, permissionMode, Date.now())
  bus.publish({ kind: 'budget' })
  return id
}

export function unqueue(id: string) {
  const res = run('DELETE FROM queue WHERE id = ? AND started_at IS NULL', id)
  if (res.changes) bus.publish({ kind: 'budget' })
  return res.changes > 0
}

/** Lets a paused session go: spare usage will not pick it up. */
export function dropPaused(sessionId: string) {
  const res = run('UPDATE paused SET resumed_at = ? WHERE session_id = ? AND resumed_at IS NULL', Date.now(), sessionId)
  if (res.changes) bus.publish({ kind: 'budget' })
  return res.changes > 0
}

export function budgetState(now = Date.now()) {
  const r = currentBudget(now)
  return {
    on: BUDGET.on,
    guard: BUDGET.guard,
    wrapAt: BUDGET.wrapAt,
    stopAt: BUDGET.stopAt,
    spareMin: Math.round(BUDGET.spareMs / 60_000),
    phase: r.phase,
    spare: r.spare,
    paused: all<{ sessionId: string; projectId: string | null; title: string | null; pausedAt: number }>(
      `SELECT p.session_id sessionId, p.project_id projectId, s.title, p.paused_at pausedAt
       FROM paused p LEFT JOIN sessions s ON s.id = p.session_id
       WHERE p.resumed_at IS NULL AND p.paused_at >= ? ORDER BY p.paused_at`,
      now - PAUSE_KEEP_MS,
    ),
    queue: all<{ id: string; projectId: string; text: string; permissionMode: string; addedAt: number }>(
      'SELECT id, project_id projectId, text, permission_mode permissionMode, added_at addedAt FROM queue WHERE started_at IS NULL ORDER BY added_at',
    ),
  }
}

export function startBudget() {
  if (!BUDGET.on) return
  const tick = () => {
    try {
      spendSpare()
    } catch (err) {
      console.warn('Spare usage could not start a task:', err)
    }
  }
  setInterval(tick, 60_000).unref()
  // A session going idle can free the floor for the next job; wait a moment for others to settle.
  bus.on('event', (ev) => {
    if (ev.kind === 'limits' || (ev.kind === 'session' && ev.state !== 'working')) setTimeout(tick, 5_000).unref()
  })
}
