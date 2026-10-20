import { randomUUID } from 'node:crypto'
import { all, get, run } from './db.js'

// Each project's clipboard: your own to-do items, and the plans Claude is
// working through. Claude's plans are the to-do lists its sessions already
// write (TodoWrite) in the session logs, so they cost no tokens. A helper
// (subagent) is listed under the task that was in progress when it was sent.

export const OTHER = '_other' // the room for sessions outside your projects, as in the web app

export type StepStatus = 'pending' | 'in_progress' | 'completed'
export type Step = { text: string; status: StepStatus; active: string | null }
export type Snapshot = { ts: number; items: Step[] }
export type HelperCall = { id: string; description: string; agentId: string | null; agentType: string | null; ts: number; doneTs: number | null; isError: boolean }
export type Helper = { id: string; description: string; agentType: string | null; status: 'working' | 'done' | 'failed' | 'stopped'; steps: Step[] }
export type PlanTask = Step & { helpers: Helper[] }
export type Plan = { sessionId: string; title: string | null; state: string; startedAt: number; updatedAt: number; tasks: PlanTask[]; helpers: Helper[] }
export type Note = { id: string; projectId: string; text: string; done: boolean; addedAt: number; doneAt: number | null }

const STATUSES = new Set<StepStatus>(['pending', 'in_progress', 'completed'])
const MAX_NOTE = 500
const PLAN_DAYS = 3
const MAX_PLANS = 4

/** The items of a TodoWrite call, or null if it is not one we can read. */
export function todoItems(input: unknown): Step[] | null {
  const todos = (input as { todos?: unknown })?.todos
  if (!Array.isArray(todos)) return null
  const out: Step[] = []
  for (const t of todos as { content?: unknown; status?: unknown; activeForm?: unknown }[]) {
    if (typeof t?.content !== 'string' || !t.content.trim()) continue
    const status = STATUSES.has(t.status as StepStatus) ? (t.status as StepStatus) : 'pending'
    out.push({ text: t.content.trim().slice(0, 300), status, active: typeof t.activeForm === 'string' ? t.activeForm.slice(0, 300) : null })
  }
  return out
}

export function saveTodos(id: string, sessionId: string, agentId: string | null, ts: number, input: unknown) {
  const items = todoItems(input)
  if (!items) return false
  return run('INSERT OR IGNORE INTO todos (id, session_id, agent_id, ts, items) VALUES (?, ?, ?, ?, ?)', id, sessionId, agentId, ts, JSON.stringify(items)).changes > 0
}

/**
 * A session's current plan from its to-do lists, oldest first, and the helpers
 * it sent. The plan is the latest list, going back as far as the lists before
 * it share a task with it; helpers from before that belonged to older work.
 * `live` is whether the session is still going, so unfinished helpers are working.
 */
export function buildPlan(lists: Snapshot[], calls: HelperCall[], helperSteps: Map<string, Step[]>, live: boolean) {
  if (!lists.length) return null
  const latest = lists[lists.length - 1]
  const texts = new Set(latest.items.map((i) => i.text))
  let startedAt = latest.ts
  for (let i = lists.length - 1; i >= 0; i--) {
    if (!lists[i].items.some((it) => texts.has(it.text))) break
    startedAt = lists[i].ts
  }
  const tasks: PlanTask[] = latest.items.map((it) => ({ ...it, helpers: [] }))
  const byText = new Map(tasks.map((t) => [t.text, t]))
  const loose: Helper[] = []
  for (const c of [...calls].filter((c) => c.ts >= startedAt).sort((a, b) => a.ts - b.ts)) {
    let at: Snapshot | undefined
    for (const l of lists) if (l.ts <= c.ts) at = l
    const doing = at?.items.find((i) => i.status === 'in_progress')
    const helper: Helper = {
      id: c.id,
      description: c.description || 'Helper',
      agentType: c.agentType,
      status: c.doneTs ? (c.isError ? 'failed' : 'done') : live ? 'working' : 'stopped',
      steps: c.agentId ? helperSteps.get(c.agentId) ?? [] : [],
    }
    const task = doing ? byText.get(doing.text) : undefined
    ;(task ? task.helpers : loose).push(helper)
  }
  return { startedAt, updatedAt: latest.ts, tasks, helpers: loose }
}

const parse = (s: string): Step[] => {
  try {
    return JSON.parse(s)
  } catch {
    return []
  }
}

/** The plans of a project's recent sessions, newest first. */
export function plansFor(projectId: string, now = Date.now()): Plan[] {
  const cond = projectId === OTHER ? 's.project_id IS NULL' : 's.project_id = ?'
  const sessions = all<{ id: string; title: string | null; state: string }>(
    `SELECT s.id, s.title, s.state, MAX(t.ts) AS last FROM todos t JOIN sessions s ON s.id = t.session_id
     WHERE t.agent_id IS NULL AND ${cond} AND t.ts >= ? GROUP BY s.id ORDER BY last DESC LIMIT ?`,
    ...(projectId === OTHER ? [] : [projectId]), now - PLAN_DAYS * 86400_000, MAX_PLANS,
  )
  const plans: Plan[] = []
  for (const s of sessions) {
    const lists = all<{ ts: number; items: string }>('SELECT ts, items FROM todos WHERE session_id = ? AND agent_id IS NULL ORDER BY ts, rowid', s.id)
      .map((r) => ({ ts: r.ts, items: parse(r.items) }))
    const calls = all<{ id: string; summary: string | null; ts: number; done_ts: number | null; is_error: number; agent_id: string | null; agent_type: string | null }>(
      `SELECT a.id, a.summary, a.ts, a.done_ts, a.is_error, g.id AS agent_id, g.agent_type FROM actions a
       LEFT JOIN agents g ON g.parent_tool_use_id = a.id
       WHERE a.session_id = ? AND a.agent_id IS NULL AND a.tool IN ('Agent', 'Task') AND a.ts >= ?`,
      s.id, lists[0]?.ts ?? now,
    ).map((r) => ({ id: r.id, description: r.summary ?? '', agentId: r.agent_id, agentType: r.agent_type, ts: r.ts, doneTs: r.done_ts, isError: !!r.is_error }))
    const helperSteps = new Map<string, Step[]>()
    for (const r of all<{ agent_id: string; items: string }>('SELECT agent_id, items FROM todos WHERE session_id = ? AND agent_id IS NOT NULL ORDER BY ts, rowid', s.id)) {
      helperSteps.set(r.agent_id, parse(r.items))
    }
    const plan = buildPlan(lists, calls, helperSteps, s.state === 'working' || s.state === 'waiting')
    if (plan) plans.push({ sessionId: s.id, title: s.title, state: s.state, ...plan })
  }
  return plans
}

// ---- your own items ---------------------------------------------------------

type NoteRow = { id: string; project_id: string; text: string; done: number; added_at: number; done_at: number | null }
const toNote = (r: NoteRow): Note => ({ id: r.id, projectId: r.project_id, text: r.text, done: !!r.done, addedAt: r.added_at, doneAt: r.done_at })

/** Not done first, in the order you added them; then what is done, latest first. */
export function listNotes(projectId: string): Note[] {
  return all<NoteRow>('SELECT * FROM notes WHERE project_id = ? ORDER BY done, CASE WHEN done THEN -done_at ELSE added_at END', projectId).map(toNote)
}

export function cleanNote(text: unknown): string | { error: string } {
  const t = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : ''
  if (!t) return { error: 'Write something first.' }
  if (t.length > MAX_NOTE) return { error: 'That is too long for the clipboard.' }
  return t
}

export function addNote(projectId: string, text: string, now = Date.now()): Note {
  const id = randomUUID()
  run('INSERT INTO notes (id, project_id, text, added_at) VALUES (?, ?, ?, ?)', id, projectId, text, now)
  return toNote(get<NoteRow>('SELECT * FROM notes WHERE id = ?', id)!)
}

export function updateNote(id: string, patch: { done?: unknown; text?: unknown }, now = Date.now()): Note | { error: string } | null {
  const row = get<NoteRow>('SELECT * FROM notes WHERE id = ?', id)
  if (!row) return null
  if (patch.text !== undefined) {
    const t = cleanNote(patch.text)
    if (typeof t !== 'string') return t
    run('UPDATE notes SET text = ? WHERE id = ?', t, id)
  }
  if (typeof patch.done === 'boolean') run('UPDATE notes SET done = ?, done_at = ? WHERE id = ?', patch.done ? 1 : 0, patch.done ? now : null, id)
  return toNote(get<NoteRow>('SELECT * FROM notes WHERE id = ?', id)!)
}

export function removeNote(id: string) {
  return run('DELETE FROM notes WHERE id = ?', id).changes > 0
}
