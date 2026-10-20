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
  source: 'cache' | 'statusline'
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
  | { kind: 'hello'; recent: LiveEvent[]; limits: Limits | null }

export type ActiveSession = { id: string; projectId: string | null; title: string | null; state: SessionState; lastAt: number; entrypoint: string | null; cwd: string | null }

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
  const res = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } })
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
  usage: (range: Range, project?: string | null) => req<Usage>(`/api/usage?range=${range}${project ? `&project=${encodeURIComponent(project)}` : ''}`),
  session: (id: string) => req<SessionDetail>(`/api/sessions/${id}`),
  active: () => req<ActiveSession[]>('/api/active'),
  limits: () => req<Limits | null>('/api/limits'),
  prompt: (body: { projectId: string; text: string; mode: 'new' | 'continue'; permissionMode: 'acceptEdits' | 'plan' }) =>
    req<{ ok: true; resumed: string | null }>('/api/prompt', { method: 'POST', body: JSON.stringify(body) }),
  status: () => req<{ ready: boolean; progress: { done: number; total: number } }>('/api/status'),
}
