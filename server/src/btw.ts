import { execFile } from 'node:child_process'
import { get } from './db.js'

// A side question, like /btw in Claude Code: asked of a copy of someone's
// conversation, answered once, and then thrown away. It never joins their
// conversation, so it costs nothing on their later turns, and it can be asked
// while they are mid-task.

const MAX_QUESTION = 4_000
const WAIT_MS = 120_000

export function parseBtw(body: { text?: unknown }): { text: string } | { error: string } {
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) return { error: 'Write a question first.' }
  if (text.length > MAX_QUESTION) return { error: 'That question is too long.' }
  return { text }
}

/**
 * The CLI flags. The copy is not saved and runs no hooks, so it never shows up
 * in the office. The tool list stays as it was, so the conversation is read
 * from the prompt cache instead of paid for again; any tool it reaches for is
 * refused, and it gets one turn.
 */
export function btwArgs(sessionId: string, model: string | null) {
  const args = [
    '-p', '--resume', sessionId, '--fork-session', '--no-session-persistence',
    '--max-turns', '1', '--permission-mode', 'dontAsk',
    '--settings', JSON.stringify({ disableAllHooks: true }),
    '--output-format', 'json',
  ]
  // The same model they are on, since the cache is kept per model.
  if (model) args.push('--model', model)
  return args
}

/** The question, marked as an aside in the prompt itself so the system prompt and cache stay the same. */
export function btwPrompt(text: string) {
  return [
    '<system-reminder>This is a side question from the user. Answer it in one reply, briefly, from what you already know in this conversation.',
    'Do not use any tools. It does not change your task.</system-reminder>',
    '',
    text,
  ].join('\n')
}

/** The answer from the CLI's JSON result. */
export function btwAnswer(out: string): { answer: string } | { error: string } {
  let r: { subtype?: string; is_error?: boolean; result?: unknown }
  try {
    r = JSON.parse(out.trim().split('\n').pop() ?? '')
  } catch {
    return { error: 'Claude did not answer. Try again.' }
  }
  // Its one turn went on a tool call, so there is no answer.
  if (r.subtype === 'error_max_turns') return { error: 'That needs them to look something up. Ask it as a normal prompt instead.' }
  if (typeof r.result !== 'string' || !r.result.trim()) return { error: 'Claude did not answer. Try again.' }
  return r.is_error ? { error: r.result } : { answer: r.result.trim() }
}

/** The model on their latest turn, leaving out helpers. */
export function sessionModel(sessionId: string) {
  return get<{ model: string | null }>(
    `SELECT model FROM requests WHERE session_id = ? AND agent_id IS NULL AND model IS NOT NULL ORDER BY ts DESC LIMIT 1`,
    sessionId,
  )?.model ?? null
}

export function askBtw(sessionId: string, cwd: string, text: string): Promise<{ answer: string } | { error: string }> {
  const bin = process.env.HQ_CLAUDE_BIN ?? 'claude'
  return new Promise((resolve) => {
    const child = execFile(bin, btwArgs(sessionId, sessionModel(sessionId)), { cwd, timeout: WAIT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (stdout) return resolve(btwAnswer(stdout))
      resolve({ error: err?.killed ? 'No answer in time. Try again.' : 'Claude Code could not be started.' })
    })
    child.stdin?.on('error', () => {})
    child.stdin?.end(btwPrompt(text))
  })
}
