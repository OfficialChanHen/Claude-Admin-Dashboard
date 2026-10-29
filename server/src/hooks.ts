import { get, run } from './db.js'
import { projectForCwd } from './projects.js'
import { setSessionState } from './transcripts.js'
import { notePid } from './stop.js'
import type { SessionState } from './bus.js'

// Claude Code hooks post their stdin JSON here (see scripts/install-hooks.mjs).
// The transcripts already carry every action; hooks add the states that are
// never written there, such as waiting for permission and session end.

type HookPayload = {
  hook_event_name?: string
  session_id?: string
  cwd?: string
  notification_type?: string
  message?: string
}

const STATE: Record<string, SessionState> = {
  SessionStart: 'idle',
  UserPromptSubmit: 'working',
  PreToolUse: 'working',
  PostToolUse: 'working',
  PermissionRequest: 'waiting',
  Stop: 'idle',
  SessionEnd: 'ended',
}

/** `pid` is the claude process that ran the hook, so HQ can stop that session later. */
export function handleHook(p: HookPayload, pid?: number) {
  const sid = p.session_id
  const name = p.hook_event_name
  if (!sid || !name) return
  if (pid && name !== 'SessionEnd') notePid(sid, pid)
  if (!get('SELECT 1 FROM sessions WHERE id = ?', sid)) {
    const now = Date.now()
    run(
      'INSERT OR IGNORE INTO sessions (id, project_id, cwd, started_at, last_at) VALUES (?, ?, ?, ?, ?)',
      sid, projectForCwd(p.cwd), p.cwd ?? null, now, now,
    )
  }
  // Stopped from HQ already: the hook from the dying process must not bring it back.
  const ranByHq = name === 'SessionEnd'
    && get<{ state: string }>('SELECT state FROM sessions WHERE id = ?', sid)?.state !== 'ended'
    && !!get('SELECT 1 FROM tasks WHERE session_id = ? AND (ended_at IS NULL OR ended_at > ?)', sid, Date.now() - 60_000)
  const state = stateFor(p, ranByHq)
  if (state) setSessionState(sid, state)
}

/**
 * A session HQ ran headless ends as soon as its turn does, often on a question
 * for you. `ranByHq` keeps it at its desk instead, so you can click it and reply.
 */
export function stateFor(p: HookPayload, ranByHq: boolean): SessionState | undefined {
  const name = p.hook_event_name ?? ''
  if (name === 'SessionEnd' && ranByHq) return 'idle'
  if (name === 'Notification') {
    const t = p.notification_type ?? ''
    const msg = (p.message ?? '').toLowerCase()
    if (t === 'permission_prompt' || msg.includes('permission')) return 'waiting'
    if (t === 'idle_prompt' || msg.includes('waiting for your input')) return 'idle'
    return undefined
  }
  return STATE[name]
}
