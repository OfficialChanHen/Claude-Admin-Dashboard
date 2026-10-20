import fs from 'node:fs'
import path from 'node:path'
import { TRANSCRIPTS_DIR } from './config.js'
import { isRealPrompt, summarize } from './transcripts.js'

// A session's conversation, read straight from its log: what you asked, what
// Claude said back, and the steps in between. Keys match the live events, so
// the panel can merge history with what arrives over the websocket.

export type ChatLine =
  | { kind: 'you'; key: string; ts: number; text: string }
  | { kind: 'claude'; key: string; ts: number; text: string }
  | { kind: 'step'; key: string; ts: number; tool: string; summary: string; isError: boolean }

const TAIL = 4 * 1024 * 1024 // only the end of very long logs
const MAX_LINES = 400

type Block = { type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string; tool_use_id?: string; is_error?: boolean }
type Entry = { type?: string; timestamp?: string; isMeta?: boolean; isSidechain?: boolean; message?: { model?: string; content?: string | Block[] } }

export function chatFromLines(sessionId: string, lines: string[], cwd: string | null): ChatLine[] {
  const out: ChatLine[] = []
  const steps = new Map<string, Extract<ChatLine, { kind: 'step' }>>()
  for (const line of lines) {
    let e: Entry
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if ((e.type !== 'user' && e.type !== 'assistant') || e.isSidechain) continue
    const ts = Date.parse(e.timestamp ?? '') || 0
    const content = e.message?.content
    if (e.type === 'user') {
      if (e.isMeta) continue
      let text = typeof content === 'string' ? content : ''
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b.type === 'text') text += b.text ?? ''
          else if (b.type === 'tool_result' && b.tool_use_id && b.is_error) {
            const s = steps.get(b.tool_use_id)
            if (s) s.isError = true
          }
        }
      }
      if (text && isRealPrompt(text)) out.push({ kind: 'you', key: `p-${sessionId}-${ts}`, ts, text })
      continue
    }
    if (e.message?.model === '<synthetic>' || !Array.isArray(content)) continue
    for (const b of content) {
      if (b.type === 'text' && b.text?.trim()) {
        const text = b.text.trim()
        out.push({ kind: 'claude', key: `s-${sessionId}-${ts}-${text.length}`, ts, text })
      } else if (b.type === 'tool_use' && b.id && b.name) {
        const step = { kind: 'step' as const, key: b.id, ts, tool: b.name, summary: summarize(b.name, b.input, cwd), isError: false }
        steps.set(b.id, step)
        out.push(step)
      }
    }
  }
  return out.slice(-MAX_LINES)
}

function findLog(sessionId: string) {
  let dirs: string[] = []
  try {
    dirs = fs.readdirSync(TRANSCRIPTS_DIR)
  } catch {
    return null
  }
  for (const d of dirs) {
    const f = path.join(TRANSCRIPTS_DIR, d, `${sessionId}.jsonl`)
    if (fs.existsSync(f)) return f
  }
  return null
}

/** `sessionId` must already be checked to be a plain id; it becomes part of a path. */
export function sessionChat(sessionId: string, cwd: string | null): ChatLine[] {
  const file = findLog(sessionId)
  if (!file) return []
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    const start = Math.max(0, size - TAIL)
    const buf = Buffer.alloc(size - start)
    fs.readSync(fd, buf, 0, buf.length, start)
    const lines = buf.toString('utf8').split('\n')
    if (start > 0) lines.shift() // the first line was cut in half
    return chatFromLines(sessionId, lines.filter(Boolean), cwd)
  } finally {
    fs.closeSync(fd)
  }
}
