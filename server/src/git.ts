import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { all } from './db.js'
import { bus } from './bus.js'
import { listProjects } from './projects.js'

const exec = promisify(execFile)

// Each project's git state, read every few seconds with plain git commands, so
// the office can show commits being shipped and pushes driving off, whoever
// made them. It costs no tokens. The reflog says what moved a branch: a commit,
// a pull or a checkout look the same from HEAD alone.

export type GitInfo = {
  projectId: string
  branch: string | null
  head: string | null
  /** The last commit's subject and time. */
  subject: string | null
  lastCommitAt: number | null
  commits: number
  /** Commits not pushed yet, or null with no upstream. */
  ahead: number | null
  /** Uncommitted work against HEAD: files touched, lines added and removed. */
  files: number
  added: number
  removed: number
  /** The last session in the project, or the last commit if later. */
  lastActiveAt: number | null
}

export type GitChange = { projectId: string; change: 'commit' | 'push'; subject: string | null }

const POLL_MS = 12_000

/** Reads `git status --porcelain=v2 --branch`: the commit, branch, upstream, how far ahead, and how many files changed. */
export function parseStatus(out: string) {
  let head: string | null = null
  let branch: string | null = null
  let upstream: string | null = null
  let ahead: number | null = null
  let files = 0
  for (const line of out.split('\n')) {
    if (!line) continue
    if (line.startsWith('# branch.oid ')) {
      const v = line.slice(13).trim()
      head = v === '(initial)' ? null : v
    } else if (line.startsWith('# branch.head ')) {
      const v = line.slice(14).trim()
      branch = v === '(detached)' ? null : v
    } else if (line.startsWith('# branch.upstream ')) upstream = line.slice(18).trim()
    else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+)/)
      ahead = m ? Number(m[1]) : null
    } else if (!line.startsWith('#')) files++
  }
  return { head, branch, upstream, ahead: upstream ? ahead ?? 0 : null, files }
}

/** Reads `git diff --shortstat`: "3 files changed, 10 insertions(+), 2 deletions(-)". */
export function parseShortstat(out: string) {
  const n = (re: RegExp) => Number(out.match(re)?.[1] ?? 0)
  return { added: n(/(\d+) insertions?\(\+\)/), removed: n(/(\d+) deletions?\(-\)/) }
}

/** What moved a branch, from the top of its reflog ("commit: ...", "update by push", "pull: ..."). */
export function reflogKind(entry: string): 'commit' | 'push' | 'other' {
  const e = entry.trim()
  if (/^commit( \([^)]*\))?:/.test(e)) return 'commit'
  if (e.startsWith('update by push')) return 'push'
  return 'other'
}

/** Reads `git status --porcelain -z`: the files with uncommitted changes, new ones included. A rename is listed by its new name. */
export function parseUncommitted(out: string) {
  const files: string[] = []
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i]
    if (e.length < 4) continue
    files.push(e.slice(3))
    // A rename or copy is followed by its old name.
    if (/[RC]/.test(e.slice(0, 2))) i++
  }
  return files
}

export type Commit = { subject: string; files: string[]; pushed: boolean }

/** Reads `git log --format=%x1e%H%x00%s --name-only`; `unpushed` holds the hashes on no remote. */
export function parseLog(out: string, unpushed: Set<string>): Commit[] {
  return out.split('\x1e').filter((c) => c.trim()).map((c) => {
    const [first, ...rest] = c.split('\n')
    const [hash, subject] = first.split('\0')
    return { subject: subject ?? '', files: rest.filter(Boolean), pushed: !unpushed.has(hash) }
  })
}

/** What is uncommitted in a repo now, and the commits made since `since`, for the managers' and boss's reports. */
export async function workSince(dir: string, since: number): Promise<{ uncommitted: string[]; commits: Commit[] } | null> {
  const status = await git(dir, ['status', '--porcelain', '-z', '--untracked-files=all'])
  if (status == null) return null
  const log = (await git(dir, ['log', `--since=${new Date(since).toISOString()}`, '--format=%x1e%H%x00%s', '--name-only', 'HEAD'])) ?? ''
  const unpushed = new Set(((await git(dir, ['rev-list', 'HEAD', '--not', '--remotes'])) ?? '').split('\n').filter(Boolean))
  return { uncommitted: parseUncommitted(status), commits: parseLog(log, unpushed) }
}

type Snapshot = { head: string | null; upstreamTip: string | null }

/**
 * What happened between two looks at a repo. `headWhy` and `upWhy` are the top
 * reflog entries for HEAD and the upstream branch, read only when they moved.
 */
export function changesBetween(
  projectId: string,
  prev: Snapshot | undefined,
  next: Snapshot,
  headWhy: string,
  upWhy: string,
  subject: string | null,
): GitChange[] {
  // The first look only learns where things are.
  if (!prev) return []
  const out: GitChange[] = []
  if (next.head && next.head !== prev.head && reflogKind(headWhy) === 'commit') out.push({ projectId, change: 'commit', subject })
  if (next.upstreamTip && next.upstreamTip !== prev.upstreamTip && reflogKind(upWhy) === 'push') out.push({ projectId, change: 'push', subject })
  return out
}

async function git(cwd: string, args: string[]) {
  try {
    const { stdout } = await exec('git', ['-C', cwd, ...args], { timeout: 8000, maxBuffer: 1024 * 1024 })
    return stdout
  } catch {
    return null
  }
}

const infos = new Map<string, GitInfo>()
const snaps = new Map<string, Snapshot>()

async function look(projectId: string, dir: string, lastSession: number | null) {
  const status = await git(dir, ['status', '--porcelain=v2', '--branch', '--untracked-files=normal'])
  if (status == null) return null
  const st = parseStatus(status)
  const prev = snaps.get(projectId)
  const old = infos.get(projectId)
  const diff = st.head ? parseShortstat((await git(dir, ['diff', '--shortstat', 'HEAD'])) ?? '') : { added: 0, removed: 0 }
  const upLine = st.upstream ? ((await git(dir, ['reflog', '-1', '--format=%H%x00%gs', `refs/remotes/${st.upstream}`])) ?? '').trim() : ''
  const [upTip, upWhy] = upLine ? upLine.split('\0') : [null, '']
  let subject = old?.subject ?? null
  let lastCommitAt = old?.lastCommitAt ?? null
  let commits = old?.commits ?? 0
  let headWhy = ''
  if (st.head !== (prev?.head ?? null) || !old) {
    const log = ((await git(dir, ['log', '-1', '--format=%ct%x00%s'])) ?? '').trim()
    const [ct, subj] = log.split('\0')
    lastCommitAt = ct ? Number(ct) * 1000 : null
    subject = subj ?? null
    commits = Number(((await git(dir, ['rev-list', '--count', 'HEAD'])) ?? '0').trim()) || 0
    if (prev) headWhy = ((await git(dir, ['reflog', '-1', '--format=%gs'])) ?? '').trim()
  }
  const snap = { head: st.head, upstreamTip: upTip || null }
  const changes = changesBetween(projectId, prev, snap, headWhy, upWhy ?? '', subject)
  snaps.set(projectId, snap)
  const info: GitInfo = {
    projectId, branch: st.branch, head: st.head, subject, lastCommitAt, commits, ahead: st.ahead,
    files: st.files, added: diff.added, removed: diff.removed,
    lastActiveAt: Math.max(lastSession ?? 0, lastCommitAt ?? 0) || null,
  }
  infos.set(projectId, info)
  const moved = !old || old.head !== info.head || old.files !== info.files || old.added !== info.added || old.removed !== info.removed || old.ahead !== info.ahead || old.lastActiveAt !== info.lastActiveAt
  return { changes, moved }
}

export function gitState(): GitInfo[] {
  return [...infos.values()]
}

let running = false
async function round() {
  if (running) return
  running = true
  try {
    const last = new Map(all<{ project_id: string; t: number }>('SELECT project_id, MAX(last_at) t FROM sessions WHERE project_id IS NOT NULL GROUP BY project_id').map((r) => [r.project_id, r.t]))
    let moved = false
    const projects = listProjects().filter((p) => p.enabled && fs.existsSync(path.join(p.path, '.git')))
    const ids = new Set(projects.map((p) => p.id))
    for (const id of infos.keys()) if (!ids.has(id)) infos.delete(id)
    for (const p of projects) {
      const r = await look(p.id, p.path, last.get(p.id) ?? null)
      if (!r) continue
      moved ||= r.moved
      for (const c of r.changes) bus.publish({ kind: 'git', ...c, ts: Date.now() })
    }
    if (moved) bus.publish({ kind: 'git_state' })
  } finally {
    running = false
  }
}

export function startGit() {
  round()
  setInterval(round, POLL_MS).unref()
}
