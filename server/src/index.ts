import fs from 'node:fs'
import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import fastifyStatic from '@fastify/static'
import { HOST, PORT, WEB_DIST, ACTIVE_WINDOW_MS, APPROVAL_WAIT_MS, HEADLESS_APPROVAL_WAIT_MS, CHAT_DIR } from './config.js'
import { bus, type LiveEvent } from './bus.js'
import { all, get, run } from './db.js'
import { addProject, listProjects, openInVsCode, projectForCwd, removeProject, scanProjects, updateProject } from './projects.js'
import { startTranscripts, recentEvents, isReady, setSessionState, summarize } from './transcripts.js'
import { Approvals, describeInput, hookReply, promptAnswer, type Approval, type Decision, type PromptAnswer } from './approvals.js'
import { handleMcp, PROMPT_TOOL, type PromptInput } from './mcp.js'
import { startLimits, getLimits, acceptStatusLine } from './limits.js'
import { handleHook } from './hooks.js'
import { activeSessions, dbStats, listSessions, sessionDetail, usageSummary } from './usage.js'
import { headlessSession, joinTask, parsePrompt, resumableChat, runningPrompts, sessionTarget, startPrompt } from './prompt.js'
import { SESSION_ID, stopSession } from './stop.js'
import { sessionChat } from './chat.js'
import { hierarchyState, startHierarchy, toolsFor } from './hierarchy.js'
import { adviseHook, budgetState, dropPaused, queuePrompt, runQueued, startBudget, unqueue } from './budget.js'
import { gitState, startGit } from './git.js'
import { previewFile, previewState, startPreviews } from './previews.js'
import { recoverTasks } from './recover.js'
import { startUsageCsv } from './usageCsv.js'

// Tasks started before this moment belong to the last run of HQ.
const bootAt = Date.now()

/** The claude process a hook came from, sent by the hook command as a header. */
function claudePid(headers: Record<string, unknown>) {
  const n = Number(headers['x-claude-pid'])
  return Number.isInteger(n) && n > 1 ? n : undefined
}

const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 2 * 1024 * 1024 })
await app.register(websocket)

const progress = { done: 0, total: 0 }
const approvals = new Approvals((ev) => bus.publish(ev), APPROVAL_WAIT_MS)

function sinceFor(range: string | undefined) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  switch (range) {
    case '7d':
      return d.getTime() - 6 * 86400_000
    case '30d':
      return d.getTime() - 29 * 86400_000
    case 'all':
      return 0
    default:
      return d.getTime()
  }
}

// Sessions logged before their project was added get claimed by it.
function remapUnowned() {
  const rows = all<{ id: string; cwd: string }>('SELECT id, cwd FROM sessions WHERE project_id IS NULL AND cwd IS NOT NULL')
  for (const r of rows) {
    const pid = projectForCwd(r.cwd)
    if (!pid) continue
    run('UPDATE sessions SET project_id = ? WHERE id = ?', pid, r.id)
    run('UPDATE requests SET project_id = ? WHERE session_id = ?', pid, r.id)
    run('UPDATE actions SET project_id = ? WHERE session_id = ?', pid, r.id)
  }
}

app.get('/api/status', async () => ({ ready: isReady(), progress, stats: dbStats() }))

app.get('/api/projects', async () => listProjects())
app.post<{ Body: { path: string } }>('/api/projects', async (req, reply) => {
  try {
    const p = await addProject(req.body.path)
    remapUnowned()
    return p
  } catch (err) {
    return reply.code(400).send({ error: (err as Error).message === 'Not a folder' ? 'That folder does not exist.' : 'That folder could not be added.' })
  }
})
app.post('/api/projects/scan', async () => {
  const list = await scanProjects()
  remapUnowned()
  return list
})
app.patch<{ Params: { id: string }; Body: Parameters<typeof updateProject>[1] }>('/api/projects/:id', async (req) => updateProject(req.params.id, req.body))
app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
  removeProject(req.params.id)
  return { ok: true }
})
app.post<{ Params: { id: string } }>('/api/projects/:id/vscode', async (req, reply) => {
  try {
    await openInVsCode(req.params.id)
    return { ok: true }
  } catch (err) {
    return reply.code(400).send({ error: (err as Error).message })
  }
})

app.get<{ Querystring: { range?: string; project?: string } }>('/api/usage', async (req) =>
  usageSummary({ since: sinceFor(req.query.range), projectId: req.query.project || null }),
)
app.get<{ Querystring: { range?: string; project?: string; limit?: string } }>('/api/sessions', async (req) =>
  listSessions({ since: sinceFor(req.query.range ?? '30d'), projectId: req.query.project || null, limit: Number(req.query.limit ?? 50) }),
)
app.get<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => sessionDetail(req.params.id) ?? reply.code(404).send({ error: 'No such session.' }))
// The conversation so far: what you asked, what Claude said and the steps it took.
app.get<{ Params: { id: string } }>('/api/sessions/:id/chat', async (req, reply) => {
  if (!SESSION_ID.test(req.params.id)) return reply.code(404).send({ error: 'No such session.' })
  const cwd = get<{ cwd: string | null }>('SELECT cwd FROM sessions WHERE id = ?', req.params.id)?.cwd ?? null
  return sessionChat(req.params.id, cwd)
})
// Sending someone home: stops the claude process for that session. JSON only,
// so a web page elsewhere cannot trigger it with a plain form post.
app.post<{ Params: { id: string } }>('/api/sessions/:id/stop', async (req, reply) => {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return reply.code(415).send({ error: 'Send JSON.' })
  const r = stopSession(req.params.id)
  return 'error' in r ? reply.code(409).send(r) : r
})
app.get('/api/limits', async () => getLimits())
// Each project's git state and dev server, for the whiteboards and TVs in its room.
app.get('/api/git', async () => gitState())
app.get('/api/previews', async () => previewState())
app.get<{ Params: { id: string; which: string } }>('/api/previews/:id/:which', async (req, reply) => {
  const f = previewFile(req.params.id, req.params.which)
  if (!f) return reply.code(404).send({ error: 'No picture yet.' })
  return reply.type('image/png').header('cache-control', 'no-cache').send(fs.createReadStream(f))
})
app.get('/api/active', async () => activeSessions(Date.now() - ACTIVE_WINDOW_MS))

// Send a prompt to a project: starts the claude CLI there.
app.post('/api/prompt', async (req, reply) => {
  const parsed = parsePrompt((req.body ?? {}) as never)
  if ('error' in parsed) return reply.code(400).send({ error: parsed.error })
  // To one person: carries on their conversation, in the folder it ran in.
  if (parsed.sessionId) {
    if (!SESSION_ID.test(parsed.sessionId)) return reply.code(400).send({ error: 'That session is not in HQ.' })
    // Someone HQ is running mid-task takes it on board after their current step.
    if (joinTask(parsed.sessionId, parsed.text)) return { ok: true, joined: true }
    const row = get<{ project_id: string | null; cwd: string | null; state: string }>('SELECT project_id, cwd, state FROM sessions WHERE id = ?', parsed.sessionId)
    const path = listProjects().find((p) => p.id === row?.project_id)?.path ?? null
    const target = sessionTarget(row, path)
    if ('error' in target) return reply.code(target.busy ? 409 : 400).send({ error: target.error })
    if (!fs.existsSync(target.cwd)) return reply.code(400).send({ error: 'That session’s folder is gone.' })
    try {
      const { resumed } = startPrompt({ ...parsed, projectId: target.projectId }, target.cwd, parsed.sessionId)
      return { ok: true, resumed }
    } catch {
      return reply.code(500).send({ error: 'Claude Code could not be started.' })
    }
  }
  // A chat about no project: runs in HQ's chat folder and sits in Other folders.
  if (parsed.chat) {
    try {
      fs.mkdirSync(CHAT_DIR, { recursive: true })
      const resume = parsed.mode === 'continue' ? resumableChat(CHAT_DIR) ?? undefined : undefined
      const { resumed } = startPrompt(parsed, CHAT_DIR, resume)
      return { ok: true, resumed }
    } catch {
      return reply.code(500).send({ error: 'Claude Code could not be started.' })
    }
  }
  const project = listProjects().find((p) => p.id === parsed.projectId)
  if (!project) return reply.code(400).send({ error: 'That project is not in HQ.' })
  if (!fs.existsSync(project.path)) return reply.code(400).send({ error: 'That project folder is gone.' })
  // "When usage is spare": waits for the last half hour before a reset.
  if ((req.body as { when?: unknown })?.when === 'spare') {
    return { ok: true, queued: queuePrompt(parsed.projectId, parsed.text, parsed.permissionMode, parsed.model) }
  }
  try {
    const { resumed } = startPrompt(parsed, project.path)
    return { ok: true, resumed }
  } catch {
    return reply.code(500).send({ error: 'Claude Code could not be started.' })
  }
})
app.get('/api/prompt', async () => runningPrompts())

// The 5 hour budget: what is paused, what is queued for spare usage.
app.get('/api/budget', async () => budgetState())
app.get('/api/hierarchy', async () => hierarchyState())
app.delete<{ Params: { id: string } }>('/api/budget/queue/:id', async (req, reply) =>
  unqueue(req.params.id) ? { ok: true } : reply.code(404).send({ error: 'That task already started or was removed.' }),
)
// Runs queued work now: one task, or the whole queue.
app.post<{ Params: { id: string } }>('/api/budget/queue/:id/run', async (req, reply) => {
  try {
    const r = runQueued(req.params.id)
    if (!r.found) return reply.code(404).send({ error: 'That task already started or was removed.' })
    if (r.missing.length) return reply.code(400).send({ error: 'That project folder is gone, so the task was dropped.' })
    return { ok: true, started: r.started }
  } catch {
    return reply.code(500).send({ error: 'Claude Code could not be started.' })
  }
})
app.post('/api/budget/queue/run', async (_req, reply) => {
  try {
    const r = runQueued()
    return { ok: true, started: r.started, dropped: r.missing.length }
  } catch {
    return reply.code(500).send({ error: 'Claude Code could not be started.' })
  }
})
app.delete<{ Params: { id: string } }>('/api/budget/paused/:id', async (req, reply) =>
  dropPaused(req.params.id) ? { ok: true } : reply.code(404).send({ error: 'That session is no longer paused.' }),
)

// Hook and status line endpoints. They answer fast and never fail the caller.
app.post('/api/hook', async (req) => {
  const p = (req.body ?? {}) as { hook_event_name?: string; session_id?: string; prompt?: string }
  try {
    handleHook(p, claudePid(req.headers))
  } catch (err) {
    app.log.warn(err)
  }
  if (p.session_id && (p.hook_event_name === 'SessionEnd' || p.hook_event_name === 'Stop')) approvals.dropSession(p.session_id)
  // Prompt and tool hooks print this reply for Claude Code: it carries the budget's wrap-up and stop.
  try {
    return adviseHook(p)
  } catch (err) {
    app.log.warn(err)
    return {}
  }
})

// The PermissionRequest hook waits here for your answer in HQ. Whatever goes
// wrong, the reply is empty and Claude Code asks in the terminal instead.
type PermissionPayload = { session_id?: string; cwd?: string; tool_name?: string; tool_input?: Record<string, unknown> }
app.post('/api/permission', async (req, reply) => {
  const p = (req.body ?? {}) as PermissionPayload
  try {
    handleHook({ ...p, hook_event_name: 'PermissionRequest' }, claudePid(req.headers))
  } catch (err) {
    app.log.warn(err)
  }
  if (!p.session_id || !p.tool_name) return {}
  // Sessions HQ started ask through the permission prompt tool below, so the same step is not asked twice.
  if (headlessSession(p.session_id)) return {}
  const { id, decision } = approvals.ask({
    sessionId: p.session_id,
    projectId: projectForCwd(p.cwd),
    tool: p.tool_name,
    summary: summarize(p.tool_name, p.tool_input, p.cwd),
    detail: describeInput(p.tool_name, p.tool_input),
  })
  // Claude Code gave up on the hook (you pressed Esc, or it timed out): stop asking.
  if (id) reply.raw.on('close', () => !reply.raw.writableFinished && approvals.decide(id, null))
  const d = await decision
  if (d) setSessionState(p.session_id, 'working')
  return hookReply(d)
})
// The permission prompt tool for sessions HQ starts headless (see mcp.ts). There
// is no terminal to fall back on, so without a yes from you the step is refused.
async function askHeadless(sessionId: string, p: PromptInput, abort: AbortSignal): Promise<PromptAnswer> {
  const tool = typeof p.tool_name === 'string' ? p.tool_name : ''
  const input = p.input && typeof p.input === 'object' ? (p.input as Record<string, unknown>) : {}
  if (!tool || tool === PROMPT_TOOL) return { behavior: 'deny', message: 'That tool is only for Claude HQ.' }
  const row = get<{ project_id: string | null; cwd: string | null }>('SELECT project_id, cwd FROM sessions WHERE id = ?', sessionId)
  const started = headlessSession(sessionId)
  const { id, decision } = approvals.ask({
    sessionId,
    projectId: row?.project_id ?? started?.projectId ?? null,
    tool,
    summary: summarize(tool, input, row?.cwd ?? started?.cwd),
    detail: describeInput(tool, input),
    headless: true,
  }, Date.now(), HEADLESS_APPROVAL_WAIT_MS)
  if (id) {
    abort.addEventListener('abort', () => approvals.decide(id, null))
    setSessionState(sessionId, 'waiting')
  }
  const d = await decision
  if (id) setSessionState(sessionId, 'working')
  return promptAnswer(d, input, id !== null)
}

// Claude Code speaks MCP over HTTP here: one JSON-RPC message (or a batch) per POST, answered as JSON.
app.post<{ Params: { sid: string } }>('/mcp/:sid', async (req, reply) => {
  if (!SESSION_ID.test(req.params.sid)) return reply.code(404).send({ error: 'No such session.' })
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return reply.code(415).send({ error: 'Send JSON.' })
  const abort = new AbortController()
  reply.raw.on('close', () => !reply.raw.writableFinished && abort.abort())
  const approve = (p: PromptInput) => askHeadless(req.params.sid, p, abort.signal)
  // Managers and the boss also get their report and prompt tools here.
  const extra = toolsFor(req.params.sid)
  const body = req.body as Parameters<typeof handleMcp>[0] | Parameters<typeof handleMcp>[0][]
  const out = Array.isArray(body)
    ? (await Promise.all(body.map((m) => handleMcp(m, approve, extra)))).filter(Boolean)
    : await handleMcp(body, approve, extra)
  if (!out || (Array.isArray(out) && !out.length)) return reply.code(202).send()
  return out
})
// No server-sent stream: this server only ever answers requests.
app.get('/mcp/:sid', async (_req, reply) => reply.code(405).header('allow', 'POST').send())
app.delete('/mcp/:sid', async () => ({ ok: true }))

app.get('/api/approvals', async () => approvals.list())
app.post<{ Params: { id: string }; Body: { decision?: string } }>('/api/approvals/:id', async (req, reply) => {
  const d = req.body?.decision
  // "Ask in terminal" on a headless session refuses the step, since there is no terminal.
  const decision: Decision | null = d === 'allow' || d === 'deny' ? d : null
  if (d !== 'allow' && d !== 'deny' && d !== 'terminal') return reply.code(400).send({ error: 'Choose allow, deny or terminal.' })
  if (!approvals.decide(req.params.id, decision)) return reply.code(404).send({ error: 'That request was already answered.' })
  return { ok: true }
})
app.post('/api/statusline', async (req) => {
  try {
    acceptStatusLine((req.body as { rate_limits?: never })?.rate_limits)
  } catch (err) {
    app.log.warn(err)
  }
  return {}
})

app.register(async (scope) => {
  scope.get('/ws', { websocket: true }, (socket) => {
    const send = (ev: LiveEvent | { kind: 'hello'; recent: LiveEvent[]; limits: unknown; approvals: Approval[] }) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(ev))
    }
    send({ kind: 'hello', recent: recentEvents().slice(-200), limits: getLimits(), approvals: approvals.list() })
    const onEvent = (ev: LiveEvent) => send(ev)
    bus.on('event', onEvent)
    approvals.viewers++
    socket.on('close', () => {
      bus.off('event', onEvent)
      approvals.viewers--
    })
  })
})

if (fs.existsSync(WEB_DIST)) {
  await app.register(fastifyStatic, { root: WEB_DIST })
  app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api') ? reply.code(404).send({ error: 'Not found' }) : reply.sendFile('index.html')))
}

await app.listen({ host: HOST, port: PORT })
console.log(`HQ server on http://${HOST}:${PORT}`)

await scanProjects()
remapUnowned()
startLimits()
const t0 = Date.now()
await startTranscripts((done, total) => {
  progress.done = done
  progress.total = total
})
console.log(`Read ${progress.total} session logs in ${((Date.now() - t0) / 1000).toFixed(1)}s`, dbStats())
// Tasks the last run of HQ left open: take back the live ones, resume the ones it cut off.
// This also waits for session states, which tell a finished task from one cut off mid-step.
try {
  const r = recoverTasks(bootAt)
  if (r.reclaimed || r.resumed) console.log(`Took back ${r.reclaimed} running task(s) and resumed ${r.resumed} cut off by the restart`)
} catch (err) {
  console.warn('Tasks from before the restart could not be checked:', err)
}
// Spare usage waits until session states are read, so it never starts over a busy session.
startBudget()
startHierarchy()
startGit()
startPreviews()
startUsageCsv()
