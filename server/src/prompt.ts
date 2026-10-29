import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { DATA_DIR, PORT } from './config.js'
import { get, run } from './db.js'
import { isRunning, notePid } from './stop.js'
import { promptToolArgs } from './mcp.js'

// Sends a prompt to a project by starting the claude CLI there, headless.
// It runs on your Pro plan like any other Claude Code session, and its
// session log shows up in the office the same way.

// Auto lets Claude Code's safety check run routine steps without asking; risky
// ones are blocked or asked in HQ. acceptEdits stays valid for older queued tasks.
export const PERMISSION_MODES = ['auto', 'acceptEdits', 'default', 'plan'] as const
export type PermissionMode = (typeof PERMISSION_MODES)[number]
export type PromptMode = 'new' | 'continue'
// The CLI's short names, so a prompt keeps working as new versions come out.
// Without one, a prompt runs on your usual Claude Code model.
export const MODELS = ['fable', 'opus', 'sonnet', 'haiku'] as const
export type Model = (typeof MODELS)[number]

export type PromptBody = { projectId?: unknown; sessionId?: unknown; chat?: unknown; text?: unknown; mode?: unknown; permissionMode?: unknown; model?: unknown }
/**
 * `sessionId` sends the prompt to that one session, carrying on its conversation.
 * `chat` is a chat about no project, in HQ's chat folder.
 */
export type PromptRequest = { projectId: string; sessionId?: string; chat?: true; text: string; mode: PromptMode; permissionMode: PermissionMode; model?: Model }

const MAX_PROMPT = 20_000

export function parsePrompt(body: PromptBody): PromptRequest | { error: string } {
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const sessionId = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : undefined
  const chat = !sessionId && body.chat === true
  // A session knows its own folder, so a prompt to one needs no project, and a chat has none.
  const projectId = chat || typeof body.projectId !== 'string' ? '' : body.projectId
  if (!projectId && !sessionId && !chat) return { error: 'Pick a project first.' }
  if (!text) return { error: 'Write a prompt first.' }
  if (text.length > MAX_PROMPT) return { error: 'That prompt is too long.' }
  const mode: PromptMode = sessionId || body.mode === 'continue' ? 'continue' : 'new'
  // A chat has no plan to make, so it always runs in auto mode.
  const permissionMode = chat ? 'auto' : PERMISSION_MODES.includes(body.permissionMode as PermissionMode) ? (body.permissionMode as PermissionMode) : 'auto'
  const model = MODELS.includes(body.model as Model) ? (body.model as Model) : undefined
  return { projectId, ...(sessionId ? { sessionId } : {}), ...(chat ? { chat: true as const } : {}), text, mode, permissionMode, ...(model ? { model } : {}) }
}

/**
 * Where a prompt to one session runs: its project's folder, or the folder it
 * was started in. Someone mid-task is not interrupted; you wait for them.
 */
export function sessionTarget(
  row: { project_id: string | null; cwd: string | null; state: string } | undefined,
  projectPath: string | null,
): { cwd: string; projectId: string } | { error: string; busy?: true } {
  if (!row) return { error: 'That session is not in HQ.' }
  if (row.state === 'working' || row.state === 'waiting') return { error: 'They are still working. Send it once they finish.', busy: true }
  const cwd = projectPath ?? row.cwd
  if (!cwd) return { error: 'HQ does not know which folder that session ran in.' }
  return { cwd, projectId: row.project_id ?? '' }
}

/**
 * The CLI flags. The prompt itself goes in on stdin, never as an argument,
 * so a prompt that looks like a flag can never be read as one.
 */
export function claudeArgs(req: PromptRequest, resumeId: string | null, newId?: string, extra: string[] = []) {
  const args = ['-p', '--permission-mode', req.permissionMode, ...extra]
  if (req.model) args.push('--model', req.model)
  const resuming = req.mode === 'continue' ? resumeId : null
  if (resuming) args.push('--resume', resuming)
  // A new session gets an id up front, so HQ knows which process to stop for it.
  else if (newId) args.push('--session-id', newId)
  // There is no terminal to ask in, so steps that need your OK are asked in HQ.
  const sid = resuming || newId
  if (sid) args.push(...promptToolArgs(sid, PORT))
  return args
}

/**
 * Picking Haiku keeps the whole task cheap: its helpers run on Haiku too,
 * even ones asked for on a bigger model. Other picks leave helpers to your
 * usual settings.
 */
export function claudeEnv(model: Model | undefined, base: NodeJS.ProcessEnv = process.env) {
  if (model !== 'haiku') return base
  return { ...base, CLAUDE_CODE_SUBAGENT_MODEL: 'haiku', CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' }
}

/** The project's latest session that is not busy right now, to carry on from. */
export function resumableSession(projectId: string) {
  const row = get<{ id: string }>(
    `SELECT id FROM sessions WHERE project_id = ? AND state NOT IN ('working', 'waiting') ORDER BY last_at DESC LIMIT 1`,
    projectId,
  )
  return row?.id ?? null
}

/** The latest chat that is not busy right now, to carry on from. */
export function resumableChat(dir: string) {
  const row = get<{ id: string }>(
    `SELECT id FROM sessions WHERE cwd = ? AND state NOT IN ('working', 'waiting') ORDER BY last_at DESC LIMIT 1`,
    dir,
  )
  return row?.id ?? null
}

const running = new Map<number, { projectId: string; startedAt: number }>()

export function runningPrompts() {
  return [...running.values()]
}

// Sessions HQ is running headless right now, and the project each belongs to.
const headless = new Map<string, { projectId: string; cwd: string; taskId: string }>()

/** A session HQ started that is still running: its permission requests come through HQ's prompt tool. */
export function headlessSession(sessionId: string) {
  return headless.get(sessionId) ?? null
}

/** Keeps track of a running task until it ends. Returns the call for when it does. */
function track(taskId: string, sessionId: string, pid: number | undefined, projectId: string, cwd: string, startedAt: number, onExit?: () => void) {
  if (pid) {
    running.set(pid, { projectId, startedAt })
    notePid(sessionId, pid, true)
  }
  headless.set(sessionId, { projectId, cwd, taskId })
  let ended = false
  return () => {
    if (ended) return
    ended = true
    if (pid) running.delete(pid)
    // A newer task may have the session by now.
    if (headless.get(sessionId)?.taskId === taskId) headless.delete(sessionId)
    run('UPDATE tasks SET ended_at = ? WHERE id = ? AND ended_at IS NULL', Date.now(), taskId)
    onExit?.()
  }
}

/**
 * `resume` picks the session to carry on, instead of the project's latest.
 * `opts` is for HQ's managers and boss: a new session's id chosen up front,
 * extra CLI flags, and a call when the process ends. `recovered` marks HQ
 * resuming a task its restart cut off.
 */
export function startPrompt(
  req: PromptRequest,
  cwd: string,
  resume?: string,
  opts: { newId?: string; extraArgs?: string[]; onExit?: () => void; recovered?: boolean } = {},
) {
  const resumeId = req.mode === 'continue' ? resume ?? resumableSession(req.projectId) : null
  const bin = process.env.HQ_CLAUDE_BIN ?? 'claude'
  // Errors go to a log file; the answer itself lands in the session log.
  const log = fs.openSync(path.join(DATA_DIR, 'prompts.log'), 'a')
  fs.writeSync(log, `\n[${new Date().toISOString()}] ${req.projectId} ${req.mode}${resumeId ? ` ${resumeId}` : ''}\n`)
  const sessionId = resumeId ?? opts.newId ?? randomUUID()
  const child = spawn(bin, claudeArgs(req, resumeId, sessionId, opts.extraArgs), { cwd, env: claudeEnv(req.model), detached: true, stdio: ['pipe', 'ignore', log] })
  fs.closeSync(log)
  child.stdin?.on('error', () => {})
  child.stdin?.end(req.text)
  const taskId = randomUUID()
  const now = Date.now()
  run(
    'INSERT INTO tasks (id, session_id, project_id, cwd, permission_mode, model, pid, recovered, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    taskId, sessionId, req.projectId || null, cwd, req.permissionMode, req.model ?? null, child.pid ?? null, opts.recovered ? 1 : 0, now,
  )
  const done = track(taskId, sessionId, child.pid, req.projectId, cwd, now, opts.onExit)
  child.on('exit', done)
  child.on('error', done)
  child.unref()
  return { resumed: resumeId, sessionId }
}

/**
 * Takes back a task started before HQ restarted whose process is still
 * running: its approvals come through HQ again and Stop works. HQ is not its
 * parent any more, so it checks every few seconds for the process to end.
 */
export function adoptTask(t: { id: string; sessionId: string; projectId: string | null; cwd: string; pid: number; startedAt: number }) {
  const done = track(t.id, t.sessionId, t.pid, t.projectId ?? '', t.cwd, t.startedAt)
  const timer = setInterval(() => {
    if (isRunning(t.pid, t.sessionId)) return
    clearInterval(timer)
    done()
  }, 5_000)
  timer.unref()
}
