import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ACTIVE_WINDOW_MS, DATA_DIR, HIERARCHY } from './config.js'
import { all, get, run } from './db.js'
import { bus } from './bus.js'
import { listProjects } from './projects.js'
import { activeSessions } from './usage.js'
import { headlessSession, sessionTarget, startPrompt } from './prompt.js'
import { sessionChat } from './chat.js'
import { currentBudget } from './budget.js'
import { MCP_SERVER, type ExtraTools } from './mcp.js'
import { helperName, nameSessions, taskTitle } from './names.js'
import { workSince, type Commit } from './git.js'

// Managers and the boss. Reports go up the ranks:
//   helper (subagent) -> agent (session) -> manager -> boss
// A project gets a manager once two or more agents work in it at the same
// time. The boss comes in once two or more projects have agents working.
// Each is one Claude Code session that HQ resumes for every round. HQ gathers
// what happened from the session logs (no tokens), hands it over on stdin, and
// the manager or boss sums it up with the report tool. A round waits until most
// of the rank below is done, so the report covers finished work. Either may send the rank
// below it a prompt to sort out a problem. They don't edit code themselves.

export type Role = 'manager' | 'boss'
export type Agent = { id: string; projectId: string | null; title: string | null; state: string; lastAt: number; cwd: string | null }
export type Report = { id: string; sessionId: string; role: Role; projectId: string | null; ts: number; text: string }

/** Which managers and whether a boss are needed, from the agents at work now. HQ's own sessions don't count. */
export function whoIsNeeded(agents: Pick<Agent, 'id' | 'projectId'>[], roleIds: Set<string>) {
  const perProject = new Map<string, number>()
  for (const a of agents) if (a.projectId && !roleIds.has(a.id)) perProject.set(a.projectId, (perProject.get(a.projectId) ?? 0) + 1)
  const managers = [...perProject].filter(([, n]) => n >= 2).map(([id]) => id)
  return { managers, boss: perProject.size >= 2 }
}

/**
 * A round is due the first time, and after that only for news, and not more
 * often than everyMs. Either way it waits until most of the rank below is done,
 * unless it has waited maxWaitMs since waitingSince.
 */
export function roundDue(
  lastRound: number | null,
  running: boolean,
  lastNews: number,
  now: number,
  everyMs: number,
  done = true,
  waitingSince = now,
  maxWaitMs = Infinity,
) {
  if (running) return false
  if (lastRound != null && !(lastNews > lastRound && now - lastRound >= everyMs)) return false
  return done || now - waitingSince >= maxWaitMs
}

/** Whether at least `share` of the rank below is done. Nobody below counts as done. */
export function mostlyDone(done: boolean[], share: number) {
  return !done.length || done.filter(Boolean).length / done.length >= share
}

/**
 * An agent is done once it stopped working, none of its helpers is still at
 * work, and it has been quiet a moment. Helpers in the background end the
 * agent's own turn right away, so its state alone says done too soon.
 */
export const agentDone = (a: Pick<Agent, 'state' | 'lastAt'>, now: number, quietMs: number, helpersBusy = false) =>
  a.state !== 'working' && !helpersBusy && now - a.lastAt >= quietMs

/**
 * A manager is done for the boss once it isn't mid-round and has either
 * reported since the boss last ran or has nothing newer to report. In a busy
 * project agents move on right after each report, so waiting for a report that
 * covers their latest work would hold the boss back forever.
 */
export function managerDone(m: { running: boolean; reportedAt: number; bossLastRound: number | null; latestWork: number; agentsDone: boolean }) {
  if (m.running) return false
  return (m.bossLastRound != null && m.reportedAt > m.bossLastRound) || (m.agentsDone && m.reportedAt >= m.latestWork)
}

/**
 * The boss's closing round: once, when it stops being needed (only one project
 * is busy now, so that project's manager reports straight to the user), if
 * anything happened since its last round. It skips the wait between rounds.
 */
export function closingRoundDue(b: { wasNeeded: boolean; needed: boolean; running: boolean; lastRound: number | null; lastNews: number }) {
  return b.wasNeeded && !b.needed && !b.running && b.lastRound != null && b.lastNews > b.lastRound
}

/** Sessions with a helper that hasn't given its final answer. Helpers silent for the active window count as gone. */
function sessionsWithBusyHelpers(now: number) {
  const rows = all<{ session_id: string }>('SELECT DISTINCT session_id FROM agents WHERE done_at IS NULL AND last_at >= ?', now - ACTIVE_WINDOW_MS)
  return new Set(rows.map((r) => r.session_id))
}

export type AgentDigest = {
  id: string
  title: string
  state: string
  lastAt: number
  asked: string[]
  steps: number
  failed: number
  edited: string[]
  helpers: string[]
  lastReply: string | null
  /** Done for now: stopped working and no helper still at it. */
  finished: boolean
  /** Commits since the last report that touched its files, and its files git still shows as changed. */
  committed: { subject: string; pushed: boolean }[]
  uncommitted: string[]
}

/**
 * Which commits and uncommitted files belong to which agent, by the files it
 * edited. A file a finished agent and a working one both edited stays with the
 * working one, so committing the finished task doesn't ship half-done work.
 */
export function commitStates(agents: { id: string; edited: string[]; finished: boolean }[], work: { uncommitted: string[]; commits: Commit[] }) {
  const open = new Set(work.uncommitted)
  const busy = new Set(agents.filter((a) => !a.finished).flatMap((a) => a.edited))
  return new Map(agents.map((a) => {
    const mine = new Set(a.edited)
    return [a.id, {
      committed: work.commits.filter((c) => c.files.some((f) => mine.has(f))).map((c) => ({ subject: c.subject, pushed: c.pushed })),
      uncommitted: a.edited.filter((f) => open.has(f) && (!a.finished || !busy.has(f))),
    }]
  }))
}

const cut = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

function ago(ms: number) {
  const m = Math.round(ms / 60_000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}

/** Files that more than one agent edited, with who. */
export function sharedFiles(ds: AgentDigest[]) {
  const by = new Map<string, string[]>()
  for (const d of ds) for (const f of d.edited) by.set(f, [...(by.get(f) ?? []), d.title])
  return [...by].filter(([, who]) => who.length > 1)
}

/** What a set of agents did, as plain text for a manager or the boss to read. */
export function formatDigest(ds: AgentDigest[], now: number) {
  const out: string[] = []
  for (const d of ds) {
    out.push(`Agent "${d.title}" (${d.state}, last active ${ago(now - d.lastAt)}; session id for prompt_agent: ${d.id})`)
    if (d.asked.length) out.push(`  Asked: ${d.asked.map((a) => `"${a}"`).join('; ')}`)
    out.push(`  Did: ${d.steps} steps${d.failed ? `, ${d.failed} failed` : ''}${d.edited.length ? `; edited ${d.edited.slice(0, 12).join(', ')}` : ''}`)
    if (d.helpers.length) out.push(`  Its helpers: ${d.helpers.join('; ')}`)
    if (d.committed.length) out.push(`  Committed: ${d.committed.map((c) => `"${c.subject}" (${c.pushed ? 'pushed' : 'not pushed yet'})`).join('; ')}`)
    if (d.uncommitted.length) out.push(`  Not committed yet, ${d.finished ? 'ready to commit' : 'still being finished'}: ${d.uncommitted.slice(0, 12).join(', ')}`)
    if (d.lastReply) out.push(`  Last reply: ${d.lastReply}`)
  }
  const shared = sharedFiles(ds)
  if (shared.length) out.push('', `Files edited by more than one agent: ${shared.map(([f, who]) => `${f} (${who.join(', ')})`).join('; ')}`)
  return out.join('\n')
}

/** How a report should read, for managers and the boss alike. */
const READABLE =
  'Call each agent by its name in quotes, never by its session id. Say what changed for the user rather than listing files or step counts, unless a file is the problem. Short sentences, markdown bullets, no headings or tables.'

/** A fresh session doesn't remember earlier rounds, so it gets its last report. */
const earlier = (previous?: string) => (previous ? ['Your last report, from before this fresh session:', '', previous, ''] : [])

/** With no boss (only one project busy), the manager reports straight to the user. */
export function managerPrompt(project: string, digest: string, hasBoss: boolean, from?: string, previous?: string) {
  const up = hasBoss ? 'the boss' : 'the user'
  return [
    from ? `[A message from the boss]\n${from}\n` : '',
    `You are the manager of the project "${project}" in Claude HQ. Your agents are the Claude Code sessions working in this project. Their helpers report to them, they report to you, and you report to ${up}.`,
    '',
    ...earlier(previous),
    'What your agents did since your last report, gathered from their logs:',
    '',
    digest || '(Nothing new.)',
    '',
    '1. Look for problems across agents: two editing the same files, the same work done twice, an agent blocked or failing again and again, or work that undoes another agent\'s.',
    `2. Only if an agent needs to act, send it one short, specific instruction with prompt_agent, using its session id from above. At most ${HIERARCHY.promptsPerRound} this round. An agent that is still working can't be prompted. Don't change code yourself; you may read files to check.`,
    `3. Finish by calling report once with your summary for ${up}. ${READABLE}`,
    `   - Start with one plain sentence on how the project stands.`,
    `   - Then one bullet per agent: its name in bold, then what it did or is doing, in words someone who hasn't read the code would follow, and what it already committed and whether that is pushed.`,
    `   - Then, only if there are any: a bullet starting **Ready to commit:** naming the finished tasks whose work can be committed and pushed now, one starting **Still being finished:** naming the tasks to commit later, once they are done.`,
    `   - Then, only if there are any: a bullet starting **Needs you:** for anything ${up} must do, and one starting **Watch:** for problems and what you told whom.`,
    '   - Under 15 lines.',
  ].join('\n')
}

export function bossPrompt(sections: string, previous?: string, closing = false) {
  return [
    'You are the boss in Claude HQ. Each busy project has a manager who reports to you; in a project with one agent, that agent reports to you directly.',
    '',
    ...(closing
      ? ['This is your closing round: only one project is busy now, so its manager reports straight to the user after this. Wrap up what each project finished since your last report.', '']
      : []),
    ...earlier(previous),
    'What came in since your last report:',
    '',
    sections || '(Nothing new.)',
    '',
    '1. Look for problems that cross projects: one project waiting on another, the same fix needed in several, or work that conflicts.',
    `2. Only if something needs to happen, send one short, specific instruction with prompt_manager (to a project's manager) or prompt_agent (to an agent in a project with no manager). At most ${HIERARCHY.promptsPerRound} this round. Don't change code yourself; you may read files to check.`,
    `3. Finish by calling report once with your summary for the user. ${READABLE}`,
    '   - Start with one plain sentence on how things stand overall.',
    '   - Then one bullet per project: its name in bold, then what its agents did or are doing, each agent by its name, and what each already committed and whether that is pushed.',
    '   - Then, only if there are any: a bullet starting **Ready to commit:** naming the finished tasks, by project, whose work can be committed and pushed now, and one starting **Still being finished:** naming the tasks to commit later, once they are done.',
    '   - Then, only if there are any: a bullet starting **Needs you:** for anything the user must do, and one starting **Watch:** for problems across projects and what you told whom.',
    '   - Under 18 lines.',
  ].join('\n')
}

// ---- Runtime -------------------------------------------------------------

type RoleRow = { session_id: string; role: Role; project_id: string | null; started_at: number; last_round: number | null; retired_at: number | null }
/** The round each running manager or boss is in: prompts sent so far and whether it reported. */
const rounds = new Map<string, { startedAt: number; prompts: number; reported: boolean; cwd: string }>()

const COLS = 'session_id, role, project_id, started_at, last_round, retired_at'
/** The manager and boss sessions HQ resumes now; retired ones are left out. */
const roleRows = () => all<RoleRow>(`SELECT ${COLS} FROM roles WHERE retired_at IS NULL`)
export const roleOf = (sid: string) => get<RoleRow>(`SELECT ${COLS} FROM roles WHERE session_id = ?`, sid)

/** Agents at work now, or since `since` (the closing round looks back to the boss's last round). */
function agentsNow(now: number, since = now - ACTIVE_WINDOW_MS) {
  const ids = new Set(all<{ session_id: string }>('SELECT session_id FROM roles').map((r) => r.session_id))
  return (activeSessions(since) as Agent[]).filter((a) => !ids.has(a.id))
}

const bossNeeded = (now: number) => whoIsNeeded(agentsNow(now), new Set()).boss

function digestFor(a: Agent, since: number, finished: boolean): AgentDigest {
  const asked = all<{ text: string }>('SELECT text FROM prompts WHERE session_id = ? AND ts > ? ORDER BY ts DESC LIMIT 3', a.id, since)
    .map((p) => cut(p.text, 200))
    .reverse()
  const acts = all<{ tool: string; summary: string | null; is_error: number }>('SELECT tool, summary, is_error FROM actions WHERE session_id = ? AND ts > ?', a.id, since)
  const edited = [...new Set(acts.filter((x) => ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(x.tool) && x.summary).map((x) => x.summary!))]
  const helpers = all<{ description: string | null; agent_type: string | null }>('SELECT description, agent_type FROM agents WHERE session_id = ? AND started_at > ?', a.id, since)
    .map((h) => cut(helperName(h.description, h.agent_type), 80))
  const reply = sessionChat(a.id, a.cwd).filter((l) => l.kind === 'claude' && l.ts > since).at(-1)
  return {
    id: a.id,
    title: a.title ?? (asked[0] ? taskTitle(asked[0]) : null) ?? 'Untitled session',
    state: a.state,
    lastAt: a.lastAt,
    asked,
    steps: acts.length,
    failed: acts.filter((x) => x.is_error).length,
    edited,
    helpers,
    lastReply: reply && 'text' in reply ? cut(reply.text, 500) : null,
    finished,
    committed: [],
    uncommitted: [],
  }
}

/** Every file a session has edited, so work left uncommitted from before the last report still counts. */
const touched = (sid: string) =>
  all<{ summary: string }>(`SELECT DISTINCT summary FROM actions WHERE session_id = ? AND tool IN ('Edit', 'Write', 'MultiEdit', 'NotebookEdit') AND summary IS NOT NULL`, sid).map((r) => r.summary)

/** Digests for a project's agents, with what git says they committed and left uncommitted. */
async function projectDigests(dir: string | null, agents: Agent[], since: number, now: number) {
  const busy = sessionsWithBusyHelpers(now)
  const ds = agents.map((a) => digestFor(a, since, agentDone(a, now, HIERARCHY.quietMs, busy.has(a.id))))
  const work = dir ? await workSince(dir, since) : null
  if (!work) return ds
  const states = commitStates(ds.map((d) => ({ id: d.id, edited: touched(d.id), finished: d.finished })), work)
  return ds.map((d) => ({ ...d, ...states.get(d.id)! }))
}

function saveReport(sid: string, text: string, now = Date.now()) {
  const role = roleOf(sid)
  if (!role) return
  const r: Report = { id: randomUUID(), sessionId: sid, role: role.role, projectId: role.project_id, ts: now, text: text.trim().slice(0, 4000) }
  run('INSERT INTO reports (id, session_id, role, project_id, ts, text) VALUES (?, ?, ?, ?, ?, ?)', r.id, r.sessionId, r.role, r.projectId, r.ts, r.text)
  bus.publish({ kind: 'report', report: r })
}

/** Without a report call, the round's last reply stands in for the report. */
function endRound(sid: string) {
  const round = rounds.get(sid)
  rounds.delete(sid)
  if (!round || round.reported) return
  const last = sessionChat(sid, round.cwd).filter((l) => l.kind === 'claude' && l.ts >= round.startedAt).at(-1)
  if (last && 'text' in last && last.text.trim()) saveReport(sid, last.text)
}

const TOOL = (name: string) => `mcp__${MCP_SERVER}__${name}`

/**
 * Whether this round resumes the role's session or starts a fresh one. After
 * HIERARCHY.roundsPerSession rounds the old session is retired, and the fresh
 * one gets the last report in its prompt instead of the whole conversation.
 */
function nextSession(row: RoleRow | undefined, now: number): { existing?: string; previous?: string } {
  if (!row) return {}
  const done = get<{ n: number }>('SELECT COUNT(*) n FROM reports WHERE session_id = ?', row.session_id)?.n ?? 0
  if (done < HIERARCHY.roundsPerSession) return { existing: row.session_id }
  run('UPDATE roles SET retired_at = ? WHERE session_id = ?', now, row.session_id)
  const last = get<{ text: string }>('SELECT text FROM reports WHERE session_id = ? ORDER BY ts DESC LIMIT 1', row.session_id)
  return { previous: last?.text }
}

/** Starts a round, as a new session or by resuming the one this role already has. */
function startRound(role: Role, projectId: string | null, cwd: string, text: string, existing: string | undefined, now: number) {
  const sid = existing ?? randomUUID()
  if (!existing) run('INSERT INTO roles (session_id, role, project_id, started_at) VALUES (?, ?, ?, ?)', sid, role, projectId, now)
  run('UPDATE roles SET last_round = ? WHERE session_id = ?', now, sid)
  rounds.set(sid, { startedAt: now, prompts: 0, reported: false, cwd })
  const tools = role === 'manager' ? ['report', 'prompt_agent'] : ['report', 'prompt_manager', 'prompt_agent']
  try {
    startPrompt(
      { projectId: projectId ?? '', text, mode: existing ? 'continue' : 'new', permissionMode: 'default' },
      cwd,
      existing,
      {
        newId: existing ? undefined : sid,
        // They only read and delegate, so they get just those tools: no other
        // built-in tools, none of your MCP servers and no skills. Every tool
        // left out is one less definition sent with each of their requests.
        extraArgs: [
          '--model', HIERARCHY.model,
          '--effort', HIERARCHY.effort,
          '--tools', 'Read,Grep,Glob',
          '--allowedTools', 'Read', 'Grep', 'Glob', ...tools.map(TOOL),
          '--strict-mcp-config',
          '--disable-slash-commands',
        ],
        onExit: () => endRound(sid),
      },
    )
  } catch {
    rounds.delete(sid)
  }
  bus.publish({ kind: 'hierarchy' })
}

function bossDir() {
  const dir = path.join(DATA_DIR, 'boss')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Rounds reading git before they start, by project id or 'boss', so the next check doesn't start them twice. */
const starting = new Set<string>()

/** Runs `go` unless that role's round is already starting; failures are logged, not thrown. */
function begin(key: string, go: () => Promise<void>) {
  if (starting.has(key)) return
  starting.add(key)
  go().catch((err) => console.error('[HQ] managers:', err)).finally(() => starting.delete(key))
}

function managerRound(projectId: string, agents: Agent[], row: RoleRow | undefined, now: number, from?: string) {
  const project = listProjects().find((p) => p.id === projectId)
  if (!project || !fs.existsSync(project.path)) return
  const since = row?.last_round ?? now - 3 * ACTIVE_WINDOW_MS
  begin(projectId, async () => {
    const digest = formatDigest(await projectDigests(project.path, agents, since, now), now)
    const { existing, previous } = nextSession(row, now)
    startRound('manager', projectId, project.path, managerPrompt(project.name, digest, bossNeeded(now), from, previous), existing, now)
  })
}

function bossRound(agents: Agent[], managed: Set<string>, row: RoleRow | undefined, now: number, closing = false) {
  begin('boss', () => bossRoundNow(agents, managed, row, now, closing))
}

async function bossRoundNow(agents: Agent[], managed: Set<string>, row: RoleRow | undefined, now: number, closing: boolean) {
  const since = row?.last_round ?? now - 3 * ACTIVE_WINDOW_MS
  const projects = listProjects()
  const names = new Map(projects.map((p) => [p.id, p.name]))
  const parts: string[] = []
  const reports = all<{ project_id: string; text: string }>(
    `SELECT project_id, text FROM reports WHERE role = 'manager' AND ts > ? AND ts = (SELECT MAX(ts) FROM reports r2 WHERE r2.project_id = reports.project_id AND r2.role = 'manager')`,
    since,
  )
  for (const r of reports) parts.push(`Report from the manager of "${names.get(r.project_id) ?? r.project_id}" (project id ${r.project_id}):\n${r.text}`)
  const byProject = new Map<string, Agent[]>()
  for (const a of agents) if (a.projectId && !managed.has(a.projectId)) byProject.set(a.projectId, [...(byProject.get(a.projectId) ?? []), a])
  for (const [pid, list] of byProject) {
    const dir = projects.find((p) => p.id === pid)?.path ?? null
    const ds = await projectDigests(dir && fs.existsSync(dir) ? dir : null, list, since, now)
    parts.push(`Project "${names.get(pid) ?? pid}" has no manager; its agent:\n${formatDigest(ds, now)}`)
  }
  const { existing, previous } = nextSession(row, now)
  startRound('boss', null, bossDir(), bossPrompt(parts.join('\n\n'), previous, closing), existing, now)
}

/** Checks the ranks and starts any round that is due. Runs every 30 seconds. */
export function hierarchyTick(now = Date.now()) {
  if (!HIERARCHY.on || currentBudget(now).phase !== 'ok') return
  const roles = roleRows()
  const agents = agentsNow(now)
  const need = whoIsNeeded(agents, new Set())
  const running = (r?: RoleRow) => !!r && (rounds.has(r.session_id) || !!headlessSession(r.session_id))
  const busyHelpers = sessionsWithBusyHelpers(now)
  const done = (a: Agent) => agentDone(a, now, HIERARCHY.quietMs, busyHelpers.has(a.id))
  const due = (key: string, row: RoleRow | undefined, news: number, allDone: boolean) =>
    roundDue(row?.last_round ?? null, running(row), news, now, HIERARCHY.everyMs, allDone, row?.last_round ?? neededSince(key, now), HIERARCHY.maxWaitMs)
  for (const key of [...firstNeeded.keys()]) if (key === 'boss' ? !need.boss : !need.managers.includes(key)) firstNeeded.delete(key)

  for (const pid of need.managers) {
    const row = roles.find((r) => r.role === 'manager' && r.project_id === pid)
    const mine = agents.filter((a) => a.projectId === pid)
    const news = Math.max(...mine.map((a) => a.lastAt))
    if (due(pid, row, news, mostlyDone(mine.map(done), HIERARCHY.doneShare))) managerRound(pid, mine, row, now)
  }
  if (need.boss) {
    const row = roles.find((r) => r.role === 'boss')
    const managed = new Set(need.managers)
    const lastReport = get<{ ts: number | null }>(`SELECT MAX(ts) ts FROM reports WHERE role = 'manager'`)?.ts ?? 0
    const unmanaged = agents.filter((a) => a.projectId && !managed.has(a.projectId))
    const news = Math.max(lastReport, ...unmanaged.map((a) => a.lastAt))
    const managerIsDone = (pid: string) => {
      const mine = agents.filter((a) => a.projectId === pid)
      return managerDone({
        running: running(roles.find((r) => r.role === 'manager' && r.project_id === pid)),
        reportedAt: get<{ ts: number | null }>(`SELECT MAX(ts) ts FROM reports WHERE role = 'manager' AND project_id = ?`, pid)?.ts ?? 0,
        bossLastRound: row?.last_round ?? null,
        latestWork: Math.max(...mine.map((a) => a.lastAt)),
        agentsDone: mostlyDone(mine.map(done), HIERARCHY.doneShare),
      })
    }
    const below = [...need.managers.map(managerIsDone), ...unmanaged.map(done)]
    // On the first round, wait for the managers there are to report first.
    const waitingOnManagers = !row && need.managers.some((pid) => !all('SELECT 1 FROM reports WHERE role = ? AND project_id = ? LIMIT 1', 'manager', pid).length)
    if (!waitingOnManagers && due('boss', row, news, mostlyDone(below, HIERARCHY.doneShare))) bossRound(agents, managed, row, now)
  } else {
    const row = roles.find((r) => r.role === 'boss')
    if (row?.last_round != null) {
      // Look back to the boss's last round, so the project that just went quiet is still in it.
      const since = row.last_round
      const recent = agentsNow(now, since)
      const reported = all<{ project_id: string; ts: number }>(`SELECT project_id, ts FROM reports WHERE role = 'manager' AND ts > ?`, since)
      const lastNews = Math.max(0, ...reported.map((r) => r.ts), ...recent.map((a) => a.lastAt))
      if (closingRoundDue({ wasNeeded: bossWasNeeded, needed: false, running: running(row), lastRound: since, lastNews })) {
        bossRound(recent, new Set([...need.managers, ...reported.map((r) => r.project_id)]), row, now, true)
      }
    }
  }
  bossWasNeeded = need.boss
}

/** Whether the boss was needed at the last check, so it gets a closing round when that changes. */
let bossWasNeeded = false

/** When each manager (by project id) or the boss was first needed, so a first round that waits on busy agents still runs in time. */
const firstNeeded = new Map<string, number>()
function neededSince(key: string, now: number) {
  if (!firstNeeded.has(key)) firstNeeded.set(key, now)
  return firstNeeded.get(key)!
}

/** The report and prompt tools for a manager's or the boss's session; nothing for anyone else. */
export function toolsFor(sid: string): ExtraTools | undefined {
  const me = roleOf(sid)
  if (!me) return undefined
  const str = { type: 'string' }
  const tools: ExtraTools['tools'] = [
    {
      name: 'report',
      description: `Send your summary of this round to ${me.role === 'manager' && bossNeeded(Date.now()) ? 'the boss' : 'the user'}. Call it once, at the end.`,
      inputSchema: { type: 'object', properties: { summary: str }, required: ['summary'] },
    },
    {
      name: 'prompt_agent',
      description: me.role === 'manager'
        ? 'Send one of your agents a prompt. It carries on its own conversation with your message.'
        : 'Send a prompt to an agent in a project that has no manager.',
      inputSchema: { type: 'object', properties: { session_id: str, text: str }, required: ['session_id', 'text'] },
    },
  ]
  if (me.role === 'boss') {
    tools.push({
      name: 'prompt_manager',
      description: "Send a project's manager a message. It starts a round for that manager with your message on top.",
      inputSchema: { type: 'object', properties: { project_id: str, text: str }, required: ['project_id', 'text'] },
    })
  }
  return { tools, call: (name, args) => Promise.resolve(callTool(me, name, args)) }
}

function callTool(me: RoleRow, name: string, args: Record<string, unknown>, now = Date.now()): string {
  const text = typeof args.text === 'string' ? args.text.trim() : ''
  const round = rounds.get(me.session_id)
  if (name === 'report') {
    const summary = typeof args.summary === 'string' ? args.summary.trim() : ''
    if (!summary) return 'The summary was empty, so nothing was sent.'
    saveReport(me.session_id, summary, now)
    if (round) round.reported = true
    return 'Report sent.'
  }
  if (!text) return 'Write the message first.'
  if (round && round.prompts >= HIERARCHY.promptsPerRound) return `You have sent ${HIERARCHY.promptsPerRound} prompts this round, which is the limit. Put the rest in your report.`
  const managers = new Set(roleRows().filter((r) => r.role === 'manager').map((r) => r.project_id))
  const agents = agentsNow(now)
  const busyManagers = new Set(whoIsNeeded(agents, new Set()).managers)

  if (name === 'prompt_agent') {
    const sid = typeof args.session_id === 'string' ? args.session_id : ''
    const a = agents.find((x) => x.id === sid)
    if (!a) return 'That session is not one of the agents at work right now.'
    if (me.role === 'manager' && a.projectId !== me.project_id) return 'That agent works in another project. Only its own manager can prompt it.'
    if (me.role === 'boss' && a.projectId && busyManagers.has(a.projectId) && managers.has(a.projectId)) return 'That project has a manager. Send it to the manager with prompt_manager.'
    const row = get<{ project_id: string | null; cwd: string | null; state: string }>('SELECT project_id, cwd, state FROM sessions WHERE id = ?', sid)
    const target = sessionTarget(row, listProjects().find((p) => p.id === row?.project_id)?.path ?? null)
    if ('error' in target) return target.error
    const from = me.role === 'manager' ? 'your project manager' : 'the boss'
    try {
      startPrompt({ projectId: target.projectId, text: `[A message from ${from} in Claude HQ]\n\n${text}`, mode: 'continue', permissionMode: 'auto' }, target.cwd, sid)
    } catch {
      return 'Claude Code could not be started.'
    }
    if (round) round.prompts++
    return 'Sent. The agent is working on it.'
  }

  if (name === 'prompt_manager' && me.role === 'boss') {
    const pid = typeof args.project_id === 'string' ? args.project_id : ''
    const row = roleRows().find((r) => r.role === 'manager' && r.project_id === pid)
    if (!row) return 'That project has no manager. Prompt its agent with prompt_agent.'
    if (rounds.has(row.session_id) || headlessSession(row.session_id)) return 'That manager is in the middle of a round. Try again in its next report.'
    managerRound(pid, agents.filter((a) => a.projectId === pid), row, now, text)
    if (round) round.prompts++
    return 'Sent. The manager is starting a round with your message.'
  }
  return 'Unknown tool.'
}

/** Names for the sessions a set of reports mention by id, so they read as tasks. */
function namesIn(texts: string[]) {
  const shorts = [...new Set(texts.flatMap((t) => t.toLowerCase().match(/\b[0-9a-f]{8}\b/g) ?? []))]
  if (!shorts.length) return new Map<string, string>()
  const rows = all<{ id: string; title: string }>(
    `SELECT id, title FROM sessions WHERE title IS NOT NULL AND substr(id, 1, 8) IN (${shorts.map(() => '?').join(', ')})`,
    ...shorts,
  )
  return new Map(rows.map((r) => [r.id, r.title]))
}

export function hierarchyState(limit = 30) {
  const reports = all<Report>(
    'SELECT id, session_id sessionId, role, project_id projectId, ts, text FROM reports ORDER BY ts DESC LIMIT ?',
    limit,
  )
  // Older reports called agents by session id; show their names instead.
  const names = namesIn(reports.map((r) => r.text))
  return {
    on: HIERARCHY.on,
    everyMin: HIERARCHY.everyMs / 60_000,
    roles: roleRows().map((r) => ({ sessionId: r.session_id, role: r.role, projectId: r.project_id, lastRound: r.last_round, running: rounds.has(r.session_id) })),
    reports: reports.map((r) => ({ ...r, text: nameSessions(r.text, names) })),
  }
}

export function startHierarchy() {
  setInterval(() => {
    try {
      hierarchyTick()
    } catch (err) {
      console.error('[HQ] managers:', err)
    }
  }, 30_000).unref()
}
