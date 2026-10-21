import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { DATA_DIR, PORT } from './config.js'
import { get } from './db.js'
import { notePid } from './stop.js'
import { promptToolArgs } from './mcp.js'

// Sends a prompt to a project by starting the claude CLI there, headless.
// It runs on your Pro plan like any other Claude Code session, and its
// session log shows up in the office the same way.

export const PERMISSION_MODES = ['acceptEdits', 'default', 'plan'] as const
export type PermissionMode = (typeof PERMISSION_MODES)[number]
export type PromptMode = 'new' | 'continue'

export type PromptBody = { projectId?: unknown; sessionId?: unknown; text?: unknown; mode?: unknown; permissionMode?: unknown }
/** `sessionId` sends the prompt to that one session, carrying on its conversation. */
export type PromptRequest = { projectId: string; sessionId?: string; text: string; mode: PromptMode; permissionMode: PermissionMode }

const MAX_PROMPT = 20_000

export function parsePrompt(body: PromptBody): PromptRequest | { error: string } {
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const sessionId = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : undefined
  // A session knows its own folder, so a prompt to one needs no project.
  const projectId = typeof body.projectId === 'string' ? body.projectId : ''
  if (!projectId && !sessionId) return { error: 'Pick a project first.' }
  if (!text) return { error: 'Write a prompt first.' }
  if (text.length > MAX_PROMPT) return { error: 'That prompt is too long.' }
  const mode: PromptMode = sessionId || body.mode === 'continue' ? 'continue' : 'new'
  const permissionMode = PERMISSION_MODES.includes(body.permissionMode as PermissionMode) ? (body.permissionMode as PermissionMode) : 'acceptEdits'
  return { projectId, ...(sessionId ? { sessionId } : {}), text, mode, permissionMode }
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
  const resuming = req.mode === 'continue' ? resumeId : null
  if (resuming) args.push('--resume', resuming)
  // A new session gets an id up front, so HQ knows which process to stop for it.
  else if (newId) args.push('--session-id', newId)
  // There is no terminal to ask in, so steps that need your OK are asked in HQ.
  const sid = resuming || newId
  if (sid) args.push(...promptToolArgs(sid, PORT))
  return args
}

/** The project's latest session that is not busy right now, to carry on from. */
export function resumableSession(projectId: string) {
  const row = get<{ id: string }>(
    `SELECT id FROM sessions WHERE project_id = ? AND state NOT IN ('working', 'waiting') ORDER BY last_at DESC LIMIT 1`,
    projectId,
  )
  return row?.id ?? null
}

const running = new Map<number, { projectId: string; startedAt: number }>()

export function runningPrompts() {
  return [...running.values()]
}

// Sessions HQ is running headless right now, and the project each belongs to.
const headless = new Map<string, { projectId: string; cwd: string }>()

/** A session HQ started that is still running: its permission requests come through HQ's prompt tool. */
export function headlessSession(sessionId: string) {
  return headless.get(sessionId) ?? null
}

/**
 * `resume` picks the session to carry on, instead of the project's latest.
 * `opts` is for HQ's managers and boss: a new session's id chosen up front,
 * extra CLI flags, and a call when the process ends.
 */
export function startPrompt(
  req: PromptRequest,
  cwd: string,
  resume?: string,
  opts: { newId?: string; extraArgs?: string[]; onExit?: () => void } = {},
) {
  const resumeId = req.mode === 'continue' ? resume ?? resumableSession(req.projectId) : null
  const bin = process.env.HQ_CLAUDE_BIN ?? 'claude'
  // Errors go to a log file; the answer itself lands in the session log.
  const log = fs.openSync(path.join(DATA_DIR, 'prompts.log'), 'a')
  fs.writeSync(log, `\n[${new Date().toISOString()}] ${req.projectId} ${req.mode}${resumeId ? ` ${resumeId}` : ''}\n`)
  const sessionId = resumeId ?? opts.newId ?? randomUUID()
  const child = spawn(bin, claudeArgs(req, resumeId, sessionId, opts.extraArgs), { cwd, detached: true, stdio: ['pipe', 'ignore', log] })
  fs.closeSync(log)
  child.stdin?.on('error', () => {})
  child.stdin?.end(req.text)
  if (child.pid) {
    running.set(child.pid, { projectId: req.projectId, startedAt: Date.now() })
    notePid(sessionId, child.pid, true)
  }
  headless.set(sessionId, { projectId: req.projectId, cwd })
  let ended = false
  const done = () => {
    if (ended) return
    ended = true
    if (child.pid) running.delete(child.pid)
    headless.delete(sessionId)
    opts.onExit?.()
  }
  child.on('exit', done)
  child.on('error', done)
  child.unref()
  return { resumed: resumeId, sessionId }
}
