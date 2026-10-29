import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { watch } from 'chokidar'
import { TRANSCRIPTS_DIR } from './config.js'
import { all, get, run, tx } from './db.js'
import { bus, type LiveEvent, type SessionState } from './bus.js'
import { projectForCwd } from './projects.js'
import { taskTitle } from './names.js'

// Reads Claude Code's own session logs in ~/.claude/projects. Nothing here calls
// the API, so the visual layer costs no tokens.

const CHUNK = 4 * 1024 * 1024
const IMAGE_CHARS = 6000 // rough stand-in for an image tool result

type Ctx = { file: string; sessionId: string; agentId: string | null; live: boolean }

type Block = { type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }

type Entry = {
  type?: string
  uuid?: string
  sessionId?: string
  timestamp?: string
  cwd?: string
  entrypoint?: string
  gitBranch?: string
  isMeta?: boolean
  isSidechain?: boolean
  requestId?: string
  aiTitle?: string
  totalCostUSD?: number
  totalLinesAdded?: number
  totalLinesRemoved?: number
  modelUsage?: Record<string, { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number; costUSD?: number }>
  message?: {
    id?: string
    model?: string
    stop_reason?: string | null
    content?: string | Block[]
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
      output_tokens_details?: { thinking_tokens?: number }
      server_tool_use?: { web_search_requests?: number }
    }
  }
}

// Recent live events, replayed to a client when it connects.
const recent: LiveEvent[] = []
function emit(ctx: Ctx, ev: LiveEvent) {
  if (!ctx.live) return
  recent.push(ev)
  if (recent.length > 400) recent.splice(0, recent.length - 400)
  bus.publish(ev)
}
export function recentEvents() {
  return recent
}

function parseFile(file: string): { sessionId: string; agentId: string | null } | null {
  const rel = path.relative(TRANSCRIPTS_DIR, file).split(path.sep)
  if (rel.length === 2 && rel[1].endsWith('.jsonl')) {
    return { sessionId: rel[1].slice(0, -6), agentId: null }
  }
  const m = rel.length === 4 && rel[2] === 'subagents' ? rel[3].match(/^agent-(.+)\.jsonl$/) : null
  return m ? { sessionId: rel[1], agentId: m[1] } : null
}

export function summarize(tool: string, input: Record<string, unknown> = {}, cwd?: string | null): string {
  const s = (v: unknown) => (typeof v === 'string' ? v : '')
  const rel = (p: string) => (cwd && p.startsWith(cwd + '/') ? p.slice(cwd.length + 1) : path.basename(p))
  let out: string
  switch (tool) {
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      out = rel(s(input.file_path) || s(input.notebook_path))
      break
    case 'Bash':
      out = s(input.description) || s(input.command)
      break
    case 'Grep':
    case 'Glob':
      out = s(input.pattern)
      break
    case 'WebSearch':
      out = s(input.query)
      break
    case 'WebFetch':
      try {
        out = new URL(s(input.url)).host
      } catch {
        out = s(input.url)
      }
      break
    case 'Agent':
    case 'Task':
      out = s(input.description)
      break
    case 'Skill':
      out = s(input.skill)
      break
    case 'TodoWrite':
      out = 'Updated the to-do list'
      break
    default:
      out = Object.values(input).find((v) => typeof v === 'string') as string ?? ''
  }
  out = out.replace(/\s+/g, ' ').trim()
  return out.length > 120 ? out.slice(0, 117) + '...' : out
}

function resultChars(content: unknown): number {
  if (typeof content === 'string') return content.length
  if (!Array.isArray(content)) return 0
  let n = 0
  for (const c of content as Block[]) {
    if (c?.type === 'text') n += c.text?.length ?? 0
    else if (c?.type === 'image') n += IMAGE_CHARS
  }
  return n
}

export function isRealPrompt(text: string) {
  const t = text.trimStart()
  return !!t && !t.startsWith('<command-') && !t.startsWith('<local-command') && !t.startsWith('[Request interrupted') && !t.startsWith('<system-reminder>')
}

type SessionRow = { id: string; project_id: string | null; cwd: string | null; current_prompt: string | null; state: string }

function ensureSession(sid: string, e: Entry, ts: number): SessionRow {
  let s = get<SessionRow>('SELECT id, project_id, cwd, current_prompt, state FROM sessions WHERE id = ?', sid)
  if (!s) {
    const pid = projectForCwd(e.cwd)
    run(
      'INSERT INTO sessions (id, project_id, cwd, entrypoint, git_branch, started_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      sid, pid, e.cwd ?? null, e.entrypoint ?? null, e.gitBranch ?? null, ts, ts,
    )
    s = { id: sid, project_id: pid, cwd: e.cwd ?? null, current_prompt: null, state: 'idle' }
  } else {
    if (!s.cwd && e.cwd) {
      s.cwd = e.cwd
      s.project_id = projectForCwd(e.cwd)
      run('UPDATE sessions SET cwd = ?, project_id = ? WHERE id = ?', s.cwd, s.project_id, sid)
    }
    run('UPDATE sessions SET last_at = MAX(COALESCE(last_at, 0), ?) WHERE id = ?', ts, sid)
  }
  return s
}

// When each session started waiting for your OK. The permission hook usually lands
// before the log lines around it are read, so only lines written after it may end the wait.
const waitingSince = new Map<string, number>()
const waitingAfter = (sid: string, ts: number) => ts > (waitingSince.get(sid) ?? Infinity)
const waitingBefore = (sid: string, ts: number) => ts <= (waitingSince.get(sid) ?? -Infinity)

export function setSessionState(sid: string, state: SessionState, live = true) {
  const s = get<SessionRow>('SELECT id, project_id, state FROM sessions WHERE id = ?', sid)
  if (!s || s.state === state) return
  if (state === 'waiting') waitingSince.set(sid, Date.now())
  else waitingSince.delete(sid)
  run('UPDATE sessions SET state = ? WHERE id = ?', state, sid)
  if (live) {
    const ev: LiveEvent = { kind: 'session', sessionId: sid, projectId: s.project_id, state, ts: Date.now() }
    recent.push(ev)
    bus.publish(ev)
  }
}

function handle(ctx: Ctx, e: Entry) {
  const ts = Date.parse(e.timestamp ?? '') || Date.now()
  const sid = e.sessionId ?? ctx.sessionId

  if (e.type === 'ai-title' && !ctx.agentId) {
    run('UPDATE sessions SET title = ? WHERE id = ?', e.aiTitle ?? null, sid)
    return
  }
  if (e.type === 'cost-state') {
    run(
      'UPDATE sessions SET cost_usd = ?, lines_added = ?, lines_removed = ? WHERE id = ?',
      e.totalCostUSD ?? null, e.totalLinesAdded ?? null, e.totalLinesRemoved ?? null, sid,
    )
    for (const [model, m] of Object.entries(e.modelUsage ?? {})) {
      run(
        'INSERT OR REPLACE INTO model_costs (session_id, model, input, output, cache_read, cache_write, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?)',
        sid, model, m.inputTokens ?? 0, m.outputTokens ?? 0, m.cacheReadInputTokens ?? 0, m.cacheCreationInputTokens ?? 0, m.costUSD ?? 0,
      )
    }
    return
  }
  if (e.type !== 'user' && e.type !== 'assistant') return

  const s = ensureSession(sid, e, ts)
  const base = { sessionId: sid, projectId: s.project_id, agentId: ctx.agentId }
  if (ctx.agentId) {
    // A helper is done once it ends a turn; any later line means it is at work again.
    const done = e.type === 'assistant' && e.message?.stop_reason === 'end_turn' ? ts : null
    run('UPDATE agents SET last_at = MAX(COALESCE(last_at, 0), ?), done_at = ? WHERE id = ?', ts, done, ctx.agentId)
  }

  const content = e.message?.content

  if (e.type === 'user') {
    if (Array.isArray(content)) {
      let text = ''
      for (const b of content) {
        if (b.type === 'tool_result' && b.tool_use_id) {
          const chars = resultChars(b.content)
          const res = run(
            'UPDATE actions SET done_ts = ?, result_chars = ?, is_error = ? WHERE id = ? AND done_ts IS NULL',
            ts, chars, b.is_error ? 1 : 0, b.tool_use_id,
          )
          if (res.changes) {
            emit(ctx, { kind: 'action_done', ...base, id: b.tool_use_id, isError: !!b.is_error, resultTokens: Math.ceil(chars / 4), ts })
          }
        } else if (b.type === 'text') {
          text += b.text ?? ''
        }
      }
      if (ctx.live && !ctx.agentId && waitingAfter(sid, ts)) {
        // Answered: an interruption means you said no, a result means it carries on.
        if (text.trimStart().startsWith('[Request interrupted')) setSessionState(sid, 'idle')
        else if (content.some((b) => b.type === 'tool_result')) setSessionState(sid, 'working')
      }
      if (text) addPrompt(ctx, e, s, text, ts)
    } else if (typeof content === 'string') {
      addPrompt(ctx, e, s, content, ts)
    }
    return
  }

  // assistant
  const msg = e.message!
  if (msg.model === '<synthetic>') return
  const reqId = e.requestId ?? msg.id
  if (reqId) {
    const u = msg.usage ?? {}
    const inserted = run(
      `INSERT OR IGNORE INTO requests (id, session_id, agent_id, prompt_id, project_id, model, ts, input, output, cache_read, cache_write, thinking, web_searches)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      reqId, sid, ctx.agentId, ctx.agentId ? null : s.current_prompt, s.project_id, msg.model ?? null, ts,
      u.input_tokens ?? 0, u.output_tokens ?? 0, u.cache_read_input_tokens ?? 0, u.cache_creation_input_tokens ?? 0,
      u.output_tokens_details?.thinking_tokens ?? 0, u.server_tool_use?.web_search_requests ?? 0,
    ).changes
    if (inserted) {
      emit(ctx, {
        kind: 'usage', ...base, requestId: reqId, model: msg.model ?? '', input: u.input_tokens ?? 0, output: u.output_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, ts,
      })
    } else {
      // Later lines of the same call can carry a larger output count.
      run('UPDATE requests SET output = MAX(output, ?) WHERE id = ?', u.output_tokens ?? 0, reqId)
    }
  }

  if (!Array.isArray(content)) return
  for (const b of content) {
    if (b.type === 'tool_use' && b.id && b.name) {
      const summary = summarize(b.name, b.input, s.cwd)
      const res = run(
        `INSERT OR IGNORE INTO actions (id, session_id, agent_id, request_id, project_id, tool, summary, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        b.id, sid, ctx.agentId, reqId ?? null, s.project_id, b.name, summary, ts,
      )
      if (res.changes && reqId) run('UPDATE requests SET tool_calls = tool_calls + 1 WHERE id = ?', reqId)
      if (res.changes) emit(ctx, { kind: 'action', ...base, id: b.id, requestId: reqId ?? null, tool: b.name, summary, ts })
    } else if (b.type === 'text' && b.text?.trim()) {
      emit(ctx, { kind: 'say', ...base, text: b.text.trim(), ts })
    } else if (b.type === 'thinking') {
      emit(ctx, { kind: 'think', ...base, ts })
    }
  }
  if (ctx.live && !ctx.agentId) {
    // The tool call they are asking about is older than the wait, so it must not clear it.
    if (!waitingBefore(sid, ts)) setSessionState(sid, msg.stop_reason === 'end_turn' ? 'idle' : 'working')
  }
}

function addPrompt(ctx: Ctx, e: Entry, s: SessionRow, text: string, ts: number) {
  // A subagent's first message is its task from the parent, not something you typed.
  if (ctx.agentId || e.isMeta || !e.uuid || !isRealPrompt(text)) return
  const res = run('INSERT OR IGNORE INTO prompts (id, session_id, ts, text) VALUES (?, ?, ?, ?)', e.uuid, s.id, ts, text.slice(0, 4000))
  if (!res.changes) return
  run('UPDATE sessions SET current_prompt = ? WHERE id = ?', e.uuid, s.id)
  s.current_prompt = e.uuid
  // One HQ handed over mid-task was in the chat from the moment you sent it.
  const joined = get<{ id: string }>('SELECT id FROM joined WHERE session_id = ? AND text = ? AND seen = 0 AND ts <= ? ORDER BY ts LIMIT 1', s.id, text.trim(), ts)
  if (joined) run('UPDATE joined SET seen = 1 WHERE id = ?', joined.id)
  else {
    emit(ctx, { kind: 'prompt', sessionId: s.id, projectId: s.project_id, agentId: null, text: text.slice(0, 500), ts })
    nameAfterPrompt(ctx, s, text, ts)
  }
  if (ctx.live) setSessionState(s.id, 'working')
}

/**
 * A prompt HQ just handed to a running task. It goes in the chat now, though
 * Claude Code logs it only after the step it is on.
 */
export function noteJoined(sessionId: string, projectId: string | null, text: string, ts = Date.now()) {
  run('INSERT INTO joined (id, session_id, ts, text) VALUES (?, ?, ?, ?)', randomUUID(), sessionId, ts, text)
  emit({ file: '', sessionId, agentId: null, live: true }, { kind: 'prompt', sessionId, projectId, agentId: null, text: text.slice(0, 500), ts })
}

/**
 * Sessions HQ starts with `claude -p` never get a title from Claude Code, so
 * they are named after their first prompt. A title Claude Code writes later
 * replaces it.
 */
function nameAfterPrompt(ctx: Ctx, s: SessionRow, text: string, ts: number) {
  const title = taskTitle(text)
  if (!title || !run('UPDATE sessions SET title = ? WHERE id = ? AND title IS NULL', title, s.id).changes) return
  emit(ctx, { kind: 'session', sessionId: s.id, projectId: s.project_id, state: s.state as SessionState, title, ts })
}

/** Names the untitled sessions already read, from their first prompt. */
function nameUntitled() {
  const rows = all<{ id: string; text: string }>(
    `SELECT s.id, (SELECT p.text FROM prompts p WHERE p.session_id = s.id ORDER BY p.ts LIMIT 1) text
     FROM sessions s WHERE s.title IS NULL`,
  )
  tx(() => {
    for (const r of rows) {
      const title = r.text ? taskTitle(r.text) : null
      if (title) run('UPDATE sessions SET title = ? WHERE id = ? AND title IS NULL', title, r.id)
    }
  })
}

function registerAgent(ctx: Ctx, file: string) {
  if (!ctx.agentId || get('SELECT 1 FROM agents WHERE id = ?', ctx.agentId)) return
  let meta: { agentType?: string; description?: string; toolUseId?: string; model?: string } = {}
  try {
    meta = JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8'))
  } catch {
    // meta is written alongside; missing is fine
  }
  const now = Date.now()
  run(
    'INSERT INTO agents (id, session_id, parent_tool_use_id, agent_type, description, model, started_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ctx.agentId, ctx.sessionId, meta.toolUseId ?? null, meta.agentType ?? null, meta.description ?? null, meta.model ?? null, now, now,
  )
  const s = get<{ project_id: string | null }>('SELECT project_id FROM sessions WHERE id = ?', ctx.sessionId)
  emit(ctx, {
    kind: 'agent_start', sessionId: ctx.sessionId, projectId: s?.project_id ?? null, agentId: ctx.agentId,
    agentType: meta.agentType ?? null, description: meta.description ?? null, model: meta.model ?? null, toolUseId: meta.toolUseId ?? null, ts: now,
  })
}

// Subagent calls belong to the prompt that started the subagent.
function linkAgentPrompts(agentId?: string) {
  run(
    `UPDATE requests SET prompt_id = (
       SELECT r.prompt_id FROM agents g JOIN actions a ON a.id = g.parent_tool_use_id JOIN requests r ON r.id = a.request_id
       WHERE g.id = requests.agent_id)
     WHERE agent_id IS NOT NULL AND prompt_id IS NULL ${agentId ? 'AND agent_id = ?' : ''}`,
    ...(agentId ? [agentId] : []),
  )
}

async function ingest(file: string, live: boolean) {
  const ids = parseFile(file)
  if (!ids) return
  let size: number
  try {
    size = fs.statSync(file).size
  } catch {
    return
  }
  const row = get<{ offset: number }>('SELECT offset FROM ingest_files WHERE path = ?', file)
  let offset = row && row.offset <= size ? row.offset : 0
  if (offset === size) return

  const ctx: Ctx = { file, ...ids, live }
  if (ctx.agentId) tx(() => registerAgent(ctx, file))

  const fd = fs.openSync(file, 'r')
  try {
    let carry = Buffer.alloc(0)
    while (offset + carry.length < size) {
      const buf = Buffer.alloc(Math.min(CHUNK, size - offset - carry.length))
      const n = fs.readSync(fd, buf, 0, buf.length, offset + carry.length)
      if (!n) break
      const data = Buffer.concat([carry, buf.subarray(0, n)])
      const last = data.lastIndexOf(0x0a)
      if (last < 0) {
        carry = data
        continue
      }
      const lines = data.subarray(0, last).toString('utf8').split('\n')
      tx(() => {
        for (const line of lines) {
          if (!line) continue
          let e: Entry
          try {
            e = JSON.parse(line)
          } catch {
            continue
          }
          handle(ctx, e)
        }
      })
      offset += last + 1
      carry = data.subarray(last + 1)
      run('INSERT INTO ingest_files (path, offset, size) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET offset = excluded.offset, size = excluded.size', file, offset, size)
      if (!live) await new Promise((r) => setImmediate(r))
    }
  } finally {
    fs.closeSync(fd)
  }
  if (ctx.agentId) linkAgentPrompts(ctx.agentId)
}

function listTranscripts(): string[] {
  const out: string[] = []
  const subs: string[] = []
  for (const dir of safeReaddir(TRANSCRIPTS_DIR)) {
    const d = path.join(TRANSCRIPTS_DIR, dir)
    for (const f of safeReaddir(d)) {
      const p = path.join(d, f)
      if (f.endsWith('.jsonl')) out.push(p)
      else {
        const sd = path.join(p, 'subagents')
        for (const s of safeReaddir(sd)) if (s.endsWith('.jsonl')) subs.push(path.join(sd, s))
      }
    }
  }
  // Parents first so subagents can find the tool call that started them.
  return [...out, ...subs]
}

function safeReaddir(d: string) {
  try {
    return fs.readdirSync(d)
  } catch {
    return []
  }
}

let ready = false
export function isReady() {
  return ready
}

export async function startTranscripts(onProgress?: (done: number, total: number) => void) {
  const files = listTranscripts()
  let done = 0
  for (const f of files) {
    await ingest(f, false)
    onProgress?.(++done, files.length)
  }
  linkAgentPrompts()
  nameUntitled()
  ready = true

  const pending = new Map<string, NodeJS.Timeout>()
  const queue: string[] = []
  let busy = false
  const drain = async () => {
    if (busy) return
    busy = true
    while (queue.length) await ingest(queue.shift()!, true).catch((err) => console.error('ingest', err))
    busy = false
  }
  const schedule = (file: string) => {
    if (!file.endsWith('.jsonl')) return
    clearTimeout(pending.get(file))
    pending.set(file, setTimeout(() => {
      pending.delete(file)
      if (!queue.includes(file)) queue.push(file)
      drain()
    }, 60))
  }

  const watcher = watch(TRANSCRIPTS_DIR, {
    ignoreInitial: true,
    depth: 3,
    ignored: (p, st) => (st?.isFile() ? !p.endsWith('.jsonl') : /\/(memory|tool-results)$/.test(p)),
  })
  watcher.on('add', schedule).on('change', schedule)
  // Catch anything written while the backfill ran.
  for (const f of listTranscripts()) schedule(f)
}
