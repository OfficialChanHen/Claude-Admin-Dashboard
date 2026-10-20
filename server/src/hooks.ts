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
  let state = STATE[name]
  if (name === 'Notification') {
    const t = p.notification_type ?? ''
    const msg = (p.message ?? '').toLowerCase()
    if (t === 'permission_prompt' || msg.includes('permission')) state = 'waiting'
    else if (t === 'idle_prompt' || msg.includes('waiting for your input')) state = 'idle'
  }
  if (state) setSessionState(sid, state)
}
