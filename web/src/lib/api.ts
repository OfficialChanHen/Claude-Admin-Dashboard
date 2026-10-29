export type Project = {
  id: string
  name: string
  path: string
  aliases: string[]
  color: string
  enabled: boolean
  source: 'scan' | 'manual'
  github: string | null
  devCmd: string | null
  devPort: number | null
  prodUrl: string | null
  framework: string | null
}

export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number }
export type Window = { pct: number; resetsAt: string | null } | null
export type Limits = {
  fetchedAt: number
  source: 'api' | 'cache' | 'statusline'
  fiveHour: Window
  sevenDay: Window
  sevenDayOpus: Window
  sevenDaySonnet: Window
  breakdown: { key: string; name: string; pct: number }[]
  extraUsage: boolean
}

export type SessionState = 'working' | 'waiting' | 'idle' | 'ended'

export type LiveEvent =
  | { kind: 'prompt'; sessionId: string; projectId: string | null; agentId: string | null; text: string; ts: number }
  | { kind: 'action'; sessionId: string; projectId: string | null; agentId: string | null; id: string; requestId: string | null; tool: string; summary: string; ts: number }
  | { kind: 'action_done'; sessionId: string; projectId: string | null; agentId: string | null; id: string; isError: boolean; resultTokens: number; ts: number }
  | { kind: 'say'; sessionId: string; projectId: string | null; agentId: string | null; text: string; ts: number }
  | { kind: 'think'; sessionId: string; projectId: string | null; agentId: string | null; ts: number }
  | { kind: 'usage'; sessionId: string; projectId: string | null; agentId: string | null; requestId: string; model: string; input: number; output: number; cacheRead: number; cacheWrite: number; ts: number }
  | { kind: 'agent_start'; sessionId: string; projectId: string | null; agentId: string; agentType: string | null; description: string | null; model: string | null; toolUseId?: string | null; ts: number }
  | { kind: 'session'; sessionId: string; projectId: string | null; state: SessionState; title?: string | null; ts: number }
  | { kind: 'limits'; limits: Limits }
  | { kind: 'projects' }
  | { kind: 'budget' }
  | { kind: 'report'; report: Report }
  | { kind: 'hierarchy' }
  | { kind: 'git'; projectId: string; change: 'commit' | 'push'; subject: string | null; ts: number }
  | { kind: 'git_state' }
  | { kind: 'previews' }
  | { kind: 'approval'; approval: Approval }
  | { kind: 'approval_done'; id: string; decision: 'allow' | 'deny' | null }
  | { kind: 'hello'; recent: LiveEvent[]; limits: Limits | null; approvals?: Approval[] }

/** A project's git state, for its whiteboard and how lived-in its room looks. */
export type GitInfo = {
  projectId: string; branch: string | null; head: string | null; subject: string | null; lastCommitAt: number | null; commits: number
  ahead: number | null; files: number; added: number; removed: number; lastActiveAt: number | null
}
/** Pictures of a project's running dev server and its live site, for the TV in its room. */
export type Shot = { url: string; shotAt: number | null }
export type Preview = { projectId: string; dev: (Shot & { port: number }) | null; prod: Shot | null }

/** A session asking to use a tool, held until you answer here or it goes back to the terminal. */
export type Approval = {
  id: string; sessionId: string; projectId: string | null; tool: string; summary: string; detail: string; ts: number; expiresAt: number
  /** Started from HQ: there is no terminal, so without a yes the step is refused. */
  headless?: boolean
}

/** The 5 hour budget: when sessions wrap up and stop, and what waits for spare usage. */
export type Budget = {
  on: boolean
  guard: boolean
  wrapAt: number
  stopAt: number
  spareMin: number
  phase: 'ok' | 'wrap' | 'stop'
  spare: boolean
  paused: { sessionId: string; projectId: string | null; title: string | null; pausedAt: number }[]
  queue: { id: string; projectId: string; text: string; permissionMode: string; addedAt: number }[]
}

/** HQ's own managers (one per busy project) and the boss over them. */
export type Role = 'manager' | 'boss'
export type ActiveSession = { id: string; projectId: string | null; title: string | null; state: SessionState; lastAt: number; entrypoint: string | null; cwd: string | null; role?: Role | null }

/** What a manager or the boss summed up at the end of a round. */
export type Report = { id: string; sessionId: string; role: Role; projectId: string | null; ts: number; text: string }
export type Hierarchy = {
  on: boolean
  everyMin: number
  roles: { sessionId: string; role: Role; projectId: string | null; lastRound: number | null; running: boolean }[]
  reports: Report[]
}

type Agg = Tokens & { cost: number; calls: number }
export type ActionUsage = {
  id: string; sessionId: string; agentId: string | null; projectId: string | null; tool: string; summary: string
  ts: number; ms: number | null; isError: boolean; model: string | null; outputTokens: number; resultTokens: number; cost: number
  promptId?: string | null
}
export type PromptUsage = { id: string; sessionId: string; projectId: string | null; text: string; ts: number; calls: number; tokens: Tokens; cost: number; subagentCost: number }

export type Usage = {
  totals: Tokens & { calls: number; cost: number; subagentCost: number }
  byProject: (Agg & { projectId: string | null })[]
  byModel: (Agg & { model: string })[]
  byDay: (Agg & { day: string })[]
  byTool: { tool: string; count: number; outputTokens: number; resultTokens: number; errors: number; cost: number; avgMs: number | null }[]
  topActions: ActionUsage[]
  topPrompts: PromptUsage[]
}

export type SessionSummary = {
  id: string; projectId: string | null; title: string | null; cwd: string | null; entrypoint: string | null; branch: string | null
  startedAt: number; lastAt: number; state: SessionState; costUsd: number | null; tokens: Tokens; apiValue: number; calls: number
}
export type SessionDetail = {
  session: SessionSummary
  prompts: PromptUsage[]
  actions: ActionUsage[]
  agents: { id: string; agentType: string | null; description: string | null; model: string | null; startedAt: number; lastAt: number; parentToolUseId: string | null }[]
}

export type Range = 'today' | '7d' | '30d'

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  // Fastify rejects a JSON content-type with no body, so only send it when there is one.
  const headers = init?.body != null ? { 'content-type': 'application/json', ...init.headers } : init?.headers
  const res = await fetch(url, { ...init, headers })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? 'Something went wrong.')
  return body as T
}

export const api = {
  projects: () => req<Project[]>('/api/projects'),
  addProject: (path: string) => req<Project>('/api/projects', { method: 'POST', body: JSON.stringify({ path }) }),
  scan: () => req<Project[]>('/api/projects/scan', { method: 'POST', body: '{}' }),
  updateProject: (id: string, patch: Partial<Project>) => req<Project>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  removeProject: (id: string) => req<{ ok: true }>(`/api/projects/${id}`, { method: 'DELETE' }),
  openInVsCode: (id: string) => req<{ ok: true }>(`/api/projects/${id}/vscode`, { method: 'POST', body: '{}' }),
  usage: (range: Range, project?: string | null) => req<Usage>(`/api/usage?range=${range}${project ? `&project=${encodeURIComponent(project)}` : ''}`),
  session: (id: string) => req<SessionDetail>(`/api/sessions/${id}`),
  active: () => req<ActiveSession[]>('/api/active'),
  limits: () => req<Limits | null>('/api/limits'),
  git: () => req<GitInfo[]>('/api/git'),
  previews: () => req<Preview[]>('/api/previews'),
  prompt: (body: { projectId: string; sessionId?: string; chat?: boolean; text: string; mode: 'new' | 'continue'; permissionMode: 'auto' | 'plan'; when?: 'now' | 'spare'; model?: 'fable' | 'opus' | 'sonnet' | 'haiku' }) =>
    req<{ ok: true; resumed?: string | null; queued?: string }>('/api/prompt', { method: 'POST', body: JSON.stringify(body) }),
  budget: () => req<Budget>('/api/budget'),
  hierarchy: () => req<Hierarchy>('/api/hierarchy'),
  unqueue: (id: string) => req<{ ok: true }>(`/api/budget/queue/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  runQueued: (id?: string) =>
    req<{ ok: true; started: string[]; dropped?: number }>(id ? `/api/budget/queue/${encodeURIComponent(id)}/run` : '/api/budget/queue/run', { method: 'POST' }),
  dropPaused:(id: string) => req<{ ok: true }>(`/api/budget/paused/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  answer: (id: string, decision: 'allow' | 'deny' | 'terminal') =>
    req<{ ok: true }>(`/api/approvals/${id}`, { method: 'POST', body: JSON.stringify({ decision }) }),
  status: () => req<{ ready: boolean; progress: { done: number; total: number } }>('/api/status'),
  chat: (id: string) => req<ChatLine[]>(`/api/sessions/${encodeURIComponent(id)}/chat`),
  stopSession: (id: string) => req<{ ok: true }>(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: 'POST', body: '{}' }),
}

/** One line of a session's conversation. Keys match the live feed's keys. */
export type ChatLine =
  | { kind: 'you'; key: string; ts: number; text: string }
  | { kind: 'claude'; key: string; ts: number; text: string }
  | { kind: 'step'; key: string; ts: number; tool: string; summary: string; isError: boolean }
