import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { DATA_DIR } from './config.js'
import { get } from './db.js'

// Sends a prompt to a project by starting the claude CLI there, headless.
// It runs on your Pro plan like any other Claude Code session, and its
// session log shows up in the office the same way.

export const PERMISSION_MODES = ['acceptEdits', 'default', 'plan'] as const
export type PermissionMode = (typeof PERMISSION_MODES)[number]
export type PromptMode = 'new' | 'continue'

export type PromptBody = { projectId?: unknown; text?: unknown; mode?: unknown; permissionMode?: unknown }
export type PromptRequest = { projectId: string; text: string; mode: PromptMode; permissionMode: PermissionMode }

const MAX_PROMPT = 20_000

export function parsePrompt(body: PromptBody): PromptRequest | { error: string } {
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (typeof body.projectId !== 'string' || !body.projectId) return { error: 'Pick a project first.' }
  if (!text) return { error: 'Write a prompt first.' }
  if (text.length > MAX_PROMPT) return { error: 'That prompt is too long.' }
  const mode: PromptMode = body.mode === 'continue' ? 'continue' : 'new'
  const permissionMode = PERMISSION_MODES.includes(body.permissionMode as PermissionMode) ? (body.permissionMode as PermissionMode) : 'acceptEdits'
  return { projectId: body.projectId, text, mode, permissionMode }
}

/**
 * The CLI flags. The prompt itself goes in on stdin, never as an argument,
 * so a prompt that looks like a flag can never be read as one.
 */
export function claudeArgs(req: PromptRequest, resumeId: string | null) {
  const args = ['-p', '--permission-mode', req.permissionMode]
  if (req.mode === 'continue' && resumeId) args.push('--resume', resumeId)
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

export function startPrompt(req: PromptRequest, cwd: string) {
  const resumeId = req.mode === 'continue' ? resumableSession(req.projectId) : null
  const bin = process.env.HQ_CLAUDE_BIN ?? 'claude'
  // Errors go to a log file; the answer itself lands in the session log.
  const log = fs.openSync(path.join(DATA_DIR, 'prompts.log'), 'a')
  fs.writeSync(log, `\n[${new Date().toISOString()}] ${req.projectId} ${req.mode}${resumeId ? ` ${resumeId}` : ''}\n`)
  const child = spawn(bin, claudeArgs(req, resumeId), { cwd, detached: true, stdio: ['pipe', 'ignore', log] })
  fs.closeSync(log)
  child.stdin?.on('error', () => {})
  child.stdin?.end(req.text)
  if (child.pid) running.set(child.pid, { projectId: req.projectId, startedAt: Date.now() })
  child.on('exit', () => child.pid && running.delete(child.pid))
  child.on('error', () => child.pid && running.delete(child.pid))
  child.unref()
  return { resumed: resumeId }
}
