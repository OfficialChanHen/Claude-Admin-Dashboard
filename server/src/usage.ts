import { all, get } from './db.js'

// Token weights relative to plain input. Cache reads are cheap, 1h cache writes
// cost double, output costs five times input. The absolute price per model is
// calibrated from the cost totals Claude Code writes into each session log, so
// "API value" tracks what Claude Code itself reports without a price table here.
const W = { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 2 }

export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number }
const zero = (): Tokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
const units = (t: Tokens) => t.input * W.input + t.output * W.output + t.cacheRead * W.cacheRead + t.cacheWrite * W.cacheWrite

let rateCache: { at: number; rates: Map<string, number>; fallback: number } | null = null

function rates() {
  if (rateCache && Date.now() - rateCache.at < 60_000) return rateCache
  const rows = all<{ model: string; input: number; output: number; cache_read: number; cache_write: number; cost: number }>(
    // "claude-opus-5-5[1m]" in the cost log is "claude-opus-5-5" in the call log.
    `SELECT CASE WHEN instr(model, '[') > 0 THEN substr(model, 1, instr(model, '[') - 1) ELSE model END model, SUM(input) input, SUM(output) output, SUM(cache_read) cache_read, SUM(cache_write) cache_write, SUM(cost_usd) cost
     FROM model_costs GROUP BY 1`,
  )
  const map = new Map<string, number>()
  let totalCost = 0
  let totalUnits = 0
  for (const r of rows) {
    const u = units({ input: r.input, output: r.output, cacheRead: r.cache_read, cacheWrite: r.cache_write })
    if (u > 0 && r.cost > 0) {
      map.set(r.model, r.cost / u)
      totalCost += r.cost
      totalUnits += u
    }
  }
  rateCache = { at: Date.now(), rates: map, fallback: totalUnits ? totalCost / totalUnits : 0 }
  return rateCache
}

export function cost(model: string | null, t: Tokens) {
  const r = rates()
  return units(t) * (r.rates.get(model ?? '') ?? r.fallback)
}

const add = (a: Tokens, b: Tokens) => {
  a.input += b.input
  a.output += b.output
  a.cacheRead += b.cacheRead
  a.cacheWrite += b.cacheWrite
}

type Filter = { since: number; projectId?: string | null }

function where(f: Filter, alias: string) {
  const parts = [`${alias}.ts >= ?`]
  const params: unknown[] = [f.since]
  if (f.projectId) {
    parts.push(`${alias}.project_id = ?`)
    params.push(f.projectId)
  }
  return { sql: parts.join(' AND '), params }
}

export function usageSummary(f: Filter) {
  const w = where(f, 'r')
  const rows = all<{ project_id: string | null; model: string | null; day: string; agent: number; calls: number; input: number; output: number; cache_read: number; cache_write: number }>(
    `SELECT r.project_id, r.model, date(r.ts / 1000, 'unixepoch', 'localtime') day, (r.agent_id IS NOT NULL) agent,
            COUNT(*) calls, SUM(input) input, SUM(output) output, SUM(cache_read) cache_read, SUM(cache_write) cache_write
     FROM requests r WHERE ${w.sql} GROUP BY 1, 2, 3, 4`,
    ...w.params,
  )
  const totals = { ...zero(), calls: 0, cost: 0, subagentCost: 0 }
  const byProject = new Map<string, Tokens & { cost: number; calls: number }>()
  const byModel = new Map<string, Tokens & { cost: number; calls: number }>()
  const byDay = new Map<string, Tokens & { cost: number; calls: number }>()
  const bump = (m: Map<string, Tokens & { cost: number; calls: number }>, key: string, t: Tokens, c: number, calls: number) => {
    const cur = m.get(key) ?? { ...zero(), cost: 0, calls: 0 }
    add(cur, t)
    cur.cost += c
    cur.calls += calls
    m.set(key, cur)
  }
  for (const r of rows) {
    const t = { input: r.input, output: r.output, cacheRead: r.cache_read, cacheWrite: r.cache_write }
    const c = cost(r.model, t)
    add(totals, t)
    totals.calls += r.calls
    totals.cost += c
    if (r.agent) totals.subagentCost += c
    bump(byProject, r.project_id ?? '', t, c, r.calls)
    bump(byModel, r.model ?? 'unknown', t, c, r.calls)
    bump(byDay, r.day, t, c, r.calls)
  }
  const list = (m: Map<string, Tokens & { cost: number; calls: number }>, k: string) =>
    [...m.entries()].map(([key, v]) => ({ [k]: key || null, ...v })).sort((a, b) => b.cost - a.cost)
  return {
    totals,
    byProject: list(byProject, 'projectId'),
    byModel: list(byModel, 'model'),
    byDay: [...byDay.entries()].map(([day, v]) => ({ day, ...v })).sort((a, b) => a.day.localeCompare(b.day)),
    byTool: toolUsage(f),
    topActions: topActions(f, 12),
    topPrompts: topPrompts(f, 12),
  }
}

// Per-action numbers are estimates: one API call can make several tool calls, so
// its output is split evenly between them, and a tool's result is counted as the
// tokens it adds to the next call's input (about 4 characters per token).
const ACTION_SQL = `
  COALESCE(CAST(r.output AS REAL) / MAX(COALESCE(r.tool_calls, 1), 1), 0) AS out_share,
  COALESCE(a.result_chars, 0) / 4.0 AS result_tokens`

function actionCost(model: string | null, outShare: number, resultTokens: number) {
  return cost(model, { input: 0, output: outShare, cacheRead: 0, cacheWrite: resultTokens })
}

function toolUsage(f: Filter) {
  const w = where(f, 'a')
  const rows = all<{ tool: string; model: string | null; n: number; out_share: number; result_tokens: number; errors: number; ms: number | null }>(
    `SELECT tool, model, COUNT(*) n, SUM(out_share) out_share, SUM(result_tokens) result_tokens, SUM(is_error) errors, AVG(done_ts - ts) ms
     FROM (SELECT a.*, r.model, ${ACTION_SQL} FROM actions a LEFT JOIN requests r ON r.id = a.request_id WHERE ${w.sql})
     GROUP BY tool, model`,
    ...w.params,
  )
  const m = new Map<string, { tool: string; count: number; outputTokens: number; resultTokens: number; errors: number; cost: number; avgMs: number | null }>()
  for (const r of rows) {
    const cur = m.get(r.tool) ?? { tool: r.tool, count: 0, outputTokens: 0, resultTokens: 0, errors: 0, cost: 0, avgMs: r.ms }
    cur.count += r.n
    cur.outputTokens += r.out_share
    cur.resultTokens += r.result_tokens
    cur.errors += r.errors
    cur.cost += actionCost(r.model, r.out_share, r.result_tokens)
    m.set(r.tool, cur)
  }
  return [...m.values()].map((v) => ({ ...v, outputTokens: Math.round(v.outputTokens), resultTokens: Math.round(v.resultTokens) })).sort((a, b) => b.cost - a.cost)
}

type ActionRow = {
  id: string; session_id: string; agent_id: string | null; project_id: string | null; tool: string; summary: string
  ts: number; done_ts: number | null; is_error: number; model: string | null; out_share: number; result_tokens: number
}

function shapeAction(a: ActionRow) {
  return {
    id: a.id,
    sessionId: a.session_id,
    agentId: a.agent_id,
    projectId: a.project_id,
    tool: a.tool,
    summary: a.summary,
    ts: a.ts,
    ms: a.done_ts ? a.done_ts - a.ts : null,
    isError: !!a.is_error,
    model: a.model,
    outputTokens: Math.round(a.out_share),
    resultTokens: Math.round(a.result_tokens),
    cost: actionCost(a.model, a.out_share, a.result_tokens),
  }
}

function topActions(f: Filter, limit: number) {
  const w = where(f, 'a')
  return all<ActionRow>(
    `SELECT a.*, r.model, ${ACTION_SQL} FROM actions a LEFT JOIN requests r ON r.id = a.request_id
     WHERE ${w.sql} ORDER BY (out_share * 5 + result_tokens * 2) DESC LIMIT ?`,
    ...w.params, limit,
  ).map(shapeAction)
}

type PromptAgg = { id: string; session_id: string; text: string; ts: number; project_id: string | null; model: string | null; calls: number; input: number; output: number; cache_read: number; cache_write: number; sub: number }

function shapePrompts(rows: PromptAgg[]) {
  const m = new Map<string, { id: string; sessionId: string; projectId: string | null; text: string; ts: number; calls: number; tokens: Tokens; cost: number; subagentCost: number }>()
  for (const r of rows) {
    const cur = m.get(r.id) ?? { id: r.id, sessionId: r.session_id, projectId: r.project_id, text: r.text, ts: r.ts, calls: 0, tokens: zero(), cost: 0, subagentCost: 0 }
    const t = { input: r.input ?? 0, output: r.output ?? 0, cacheRead: r.cache_read ?? 0, cacheWrite: r.cache_write ?? 0 }
    const c = cost(r.model, t)
    add(cur.tokens, t)
    cur.calls += r.calls
    cur.cost += c
    if (r.sub) cur.subagentCost += c
    m.set(r.id, cur)
  }
  return [...m.values()]
}

const PROMPT_SQL = `
  SELECT p.id, p.session_id, p.text, p.ts, s.project_id, r.model, (r.agent_id IS NOT NULL) sub, COUNT(r.id) calls,
         SUM(r.input) input, SUM(r.output) output, SUM(r.cache_read) cache_read, SUM(r.cache_write) cache_write
  FROM prompts p JOIN sessions s ON s.id = p.session_id LEFT JOIN requests r ON r.prompt_id = p.id`

function topPrompts(f: Filter, limit: number) {
  const params: unknown[] = [f.since]
  let sql = `${PROMPT_SQL} WHERE p.ts >= ?`
  if (f.projectId) {
    sql += ' AND s.project_id = ?'
    params.push(f.projectId)
  }
  sql += ' GROUP BY p.id, r.model, sub'
  return shapePrompts(all<PromptAgg>(sql, ...params)).sort((a, b) => b.cost - a.cost).slice(0, limit)
}

export function listSessions(f: Filter & { limit: number }) {
  const params: unknown[] = [f.since]
  let sql = `SELECT s.*, COUNT(r.id) calls, SUM(r.input) input, SUM(r.output) output, SUM(r.cache_read) cache_read, SUM(r.cache_write) cache_write, r.model
             FROM sessions s LEFT JOIN requests r ON r.session_id = s.id WHERE s.last_at >= ?`
  if (f.projectId) {
    sql += ' AND s.project_id = ?'
    params.push(f.projectId)
  }
  sql += ' GROUP BY s.id, r.model ORDER BY s.last_at DESC'
  const rows = all<Record<string, unknown> & { id: string; model: string | null; input: number; output: number; cache_read: number; cache_write: number; calls: number }>(sql, ...params)
  const m = new Map<string, Record<string, unknown> & { tokens: Tokens; apiValue: number; calls: number }>()
  for (const r of rows) {
    const cur = m.get(r.id) ?? {
      id: r.id, projectId: r.project_id, title: r.title, cwd: r.cwd, entrypoint: r.entrypoint, branch: r.git_branch,
      startedAt: r.started_at, lastAt: r.last_at, state: r.state, costUsd: r.cost_usd, tokens: zero(), apiValue: 0, calls: 0,
    }
    const t = { input: r.input ?? 0, output: r.output ?? 0, cacheRead: r.cache_read ?? 0, cacheWrite: r.cache_write ?? 0 }
    add(cur.tokens, t)
    cur.apiValue += cost(r.model, t)
    cur.calls += r.calls
    m.set(r.id, cur)
  }
  return [...m.values()].slice(0, f.limit)
}

export function sessionDetail(id: string) {
  const s = listSessions({ since: 0, limit: 1e9 }).find((x) => x.id === id)
  if (!s) return null
  const prompts = shapePrompts(all<PromptAgg>(`${PROMPT_SQL} WHERE p.session_id = ? GROUP BY p.id, r.model, sub`, id)).sort((a, b) => a.ts - b.ts)
  const actions = all<ActionRow>(
    `SELECT a.*, r.model, r.prompt_id, ${ACTION_SQL} FROM actions a LEFT JOIN requests r ON r.id = a.request_id
     WHERE a.session_id = ? ORDER BY a.ts`,
    id,
  ).map((a) => ({ ...shapeAction(a), promptId: (a as unknown as { prompt_id: string | null }).prompt_id }))
  const agents = all(`SELECT id, agent_type agentType, description, model, started_at startedAt, last_at lastAt, parent_tool_use_id parentToolUseId FROM agents WHERE session_id = ?`, id)
  return { session: s, prompts, actions, agents }
}

export function activeSessions(sinceMs: number) {
  return all(
    `SELECT s.id, s.project_id projectId, s.title, s.state, s.last_at lastAt, s.entrypoint, s.cwd
     FROM sessions s WHERE s.last_at >= ? AND s.state != 'ended' ORDER BY s.last_at DESC`,
    sinceMs,
  )
}

export function projectTotalsToday(since: number) {
  return all<{ projectId: string | null; calls: number }>(
    `SELECT project_id projectId, COUNT(*) calls FROM requests WHERE ts >= ? GROUP BY project_id`,
    since,
  )
}

export function dbStats() {
  return get(`SELECT (SELECT COUNT(*) FROM sessions) sessions, (SELECT COUNT(*) FROM requests) requests, (SELECT COUNT(*) FROM actions) actions, (SELECT COUNT(*) FROM prompts) prompts`)
}
