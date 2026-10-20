import fs from 'node:fs'
import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import fastifyStatic from '@fastify/static'
import { HOST, PORT, WEB_DIST, ACTIVE_WINDOW_MS } from './config.js'
import { bus, type LiveEvent } from './bus.js'
import { all, run } from './db.js'
import { addProject, listProjects, projectForCwd, removeProject, scanProjects, updateProject } from './projects.js'
import { startTranscripts, recentEvents, isReady } from './transcripts.js'
import { startLimits, getLimits, acceptStatusLine } from './limits.js'
import { handleHook } from './hooks.js'
import { activeSessions, dbStats, listSessions, sessionDetail, usageSummary } from './usage.js'
import { parsePrompt, runningPrompts, startPrompt } from './prompt.js'

const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 2 * 1024 * 1024 })
await app.register(websocket)

const progress = { done: 0, total: 0 }

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

app.get<{ Querystring: { range?: string; project?: string } }>('/api/usage', async (req) =>
  usageSummary({ since: sinceFor(req.query.range), projectId: req.query.project || null }),
)
app.get<{ Querystring: { range?: string; project?: string; limit?: string } }>('/api/sessions', async (req) =>
  listSessions({ since: sinceFor(req.query.range ?? '30d'), projectId: req.query.project || null, limit: Number(req.query.limit ?? 50) }),
)
app.get<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => sessionDetail(req.params.id) ?? reply.code(404).send({ error: 'No such session.' }))
app.get('/api/limits', async () => getLimits())
app.get('/api/active', async () => activeSessions(Date.now() - ACTIVE_WINDOW_MS))

// Send a prompt to a project: starts the claude CLI there.
app.post('/api/prompt', async (req, reply) => {
  const parsed = parsePrompt((req.body ?? {}) as never)
  if ('error' in parsed) return reply.code(400).send({ error: parsed.error })
  const project = listProjects().find((p) => p.id === parsed.projectId)
  if (!project) return reply.code(400).send({ error: 'That project is not in HQ.' })
  if (!fs.existsSync(project.path)) return reply.code(400).send({ error: 'That project folder is gone.' })
  try {
    const { resumed } = startPrompt(parsed, project.path)
    return { ok: true, resumed }
  } catch {
    return reply.code(500).send({ error: 'Claude Code could not be started.' })
  }
})
app.get('/api/prompt', async () => runningPrompts())

// Hook and status line endpoints. They answer fast and never fail the caller.
app.post('/api/hook', async (req) => {
  try {
    handleHook(req.body as never)
  } catch (err) {
    app.log.warn(err)
  }
  return {}
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
    const send = (ev: LiveEvent | { kind: 'hello'; recent: LiveEvent[]; limits: unknown }) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(ev))
    }
    send({ kind: 'hello', recent: recentEvents().slice(-200), limits: getLimits() })
    const onEvent = (ev: LiveEvent) => send(ev)
    bus.on('event', onEvent)
    socket.on('close', () => bus.off('event', onEvent))
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
