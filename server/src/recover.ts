import fs from 'node:fs'
import { all, run } from './db.js'
import { currentBudget } from './budget.js'
import { adoptTask, startPrompt, MODELS, PERMISSION_MODES, type Model, type PermissionMode } from './prompt.js'
import { isRunning } from './stop.js'

// When HQ comes back up, it looks at each task it started that never ended.
// One whose process is still running is taken back. One whose process died
// mid-step is resumed, once, with a short note. Sessions you run yourself in a
// terminal are not HQ's tasks, so a restart never touches them.

export const RECOVER_MAX_AGE_MS = 6 * 3600_000

export const RECOVER_TEXT =
  "HQ restarted while you were working. Carry on with the task you were on; if it's done, say so in one line and stop."

export type Recovery = 'reclaim' | 'resume' | 'leave'

export type TaskCheck = {
  startedAt: number
  /** This task is itself a resume after a restart. */
  recovered: boolean
  /** A manager or the boss: their next round starts on its own schedule. */
  role: boolean
  alive: boolean
  /** The session's state from its log. Working or waiting means it was cut off mid-step. */
  state: string | null
  /** The 5 hour budget paused this session; spare usage finishes it. */
  paused: boolean
  /** The 5 hour budget is not holding new work back. */
  budgetOk: boolean
}

export function decideRecovery(t: TaskCheck, now: number): Recovery {
  if (t.alive) return 'reclaim'
  if (t.state !== 'working' && t.state !== 'waiting') return 'leave'
  if (t.recovered || t.role || t.paused || !t.budgetOk) return 'leave'
  if (now - t.startedAt > RECOVER_MAX_AGE_MS) return 'leave'
  return 'resume'
}

type OpenTask = {
  id: string
  session_id: string
  project_id: string | null
  cwd: string
  permission_mode: string
  model: string | null
  pid: number | null
  recovered: number
  started_at: number
  state: string | null
  role: number
  paused: number
}

/** Checks the tasks started before `bootAt` that never ended. */
export function recoverTasks(bootAt: number, now = Date.now()) {
  const open = all<OpenTask>(
    `SELECT t.id, t.session_id, t.project_id, t.cwd, t.permission_mode, t.model, t.pid, t.recovered, t.started_at, s.state,
       EXISTS (SELECT 1 FROM roles r WHERE r.session_id = t.session_id) role,
       EXISTS (SELECT 1 FROM paused p WHERE p.session_id = t.session_id AND p.resumed_at IS NULL) paused
     FROM tasks t LEFT JOIN sessions s ON s.id = t.session_id
     WHERE t.ended_at IS NULL AND t.started_at < ? ORDER BY t.started_at`,
    bootAt,
  )
  const budgetOk = currentBudget(now).phase === 'ok'
  const out = { reclaimed: 0, resumed: 0, left: 0 }
  // One session can have several open tasks; only its latest counts.
  const latest = new Map(open.map((t) => [t.session_id, t]))
  for (const t of open) {
    const decision =
      latest.get(t.session_id) !== t
        ? 'leave'
        : decideRecovery(
            {
              startedAt: t.started_at,
              recovered: !!t.recovered,
              role: !!t.role,
              alive: t.pid != null && isRunning(t.pid, t.session_id),
              state: t.state,
              paused: !!t.paused,
              budgetOk,
            },
            now,
          )
    if (decision === 'reclaim') {
      adoptTask({ id: t.id, sessionId: t.session_id, projectId: t.project_id, cwd: t.cwd, pid: t.pid!, startedAt: t.started_at })
      out.reclaimed++
      continue
    }
    run('UPDATE tasks SET ended_at = ? WHERE id = ?', now, t.id)
    if (decision === 'resume' && fs.existsSync(t.cwd)) {
      const permissionMode = PERMISSION_MODES.includes(t.permission_mode as PermissionMode) ? (t.permission_mode as PermissionMode) : 'acceptEdits'
      const model = MODELS.includes(t.model as Model) ? { model: t.model as Model } : {}
      startPrompt({ projectId: t.project_id ?? '', text: RECOVER_TEXT, mode: 'continue', permissionMode, ...model }, t.cwd, t.session_id, { recovered: true })
      out.resumed++
    } else out.left++
  }
  return out
}
