import fs from 'node:fs'
import { get } from './db.js'
import { setSessionState } from './transcripts.js'

// Ends a session by stopping the claude process running it. Used when you
// drag someone to the door. The conversation stays on disk, so it can be
// carried on later with "Continue last" or `claude --resume`.

export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The claude process for each session, as told by hooks or by starting it ourselves. */
const pids = new Map<string, { pid: number; group: boolean }>()

export function notePid(sessionId: string, pid: number, group = false) {
  if (!SESSION_ID.test(sessionId) || !Number.isInteger(pid) || pid <= 1) return
  pids.set(sessionId, { pid, group })
}

/** The command line of a process, or null when it is gone or not ours to read. */
function cmdline(pid: number): string[] | null {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean)
  } catch {
    return null
  }
}

function cwdOf(pid: number) {
  try {
    return fs.readlinkSync(`/proc/${pid}/cwd`)
  } catch {
    return null
  }
}

/** Is this the claude CLI? Checked before every stop, since process ids get reused. */
export function isClaude(args: string[] | null) {
  if (!args?.length) return false
  const head = args.slice(0, 2).join(' ')
  return /(^|[/\s])claude(\.exe|\.js)?($|\s)|claude-code|@anthropic-ai/.test(head)
}

/** Picks the process for a session from the running claude processes. */
export function pickProcess(
  sessionId: string,
  cwd: string | null,
  procs: { pid: number; args: string[]; cwd: string | null }[],
): { pid: number } | { error: string; gone: boolean } {
  const claude = procs.filter((p) => isClaude(p.args))
  const named = claude.filter((p) => p.args.includes(sessionId))
  if (named.length === 1) return { pid: named[0].pid }
  const here = cwd ? claude.filter((p) => p.cwd === cwd) : []
  if (here.length === 1) return { pid: here[0].pid }
  if (here.length === 0) return { error: 'That session is not running anywhere HQ can see, so there is nothing to stop.', gone: true }
  return {
    error: 'Several Claude sessions are open in that folder, so HQ cannot tell which one to stop. Run npm run hooks:install once and HQ will know.',
    gone: false,
  }
}

function listClaude() {
  const out: { pid: number; args: string[]; cwd: string | null }[] = []
  let dirs: string[] = []
  try {
    dirs = fs.readdirSync('/proc')
  } catch {
    return out
  }
  for (const d of dirs) {
    if (!/^\d+$/.test(d)) continue
    const pid = Number(d)
    if (pid === process.pid) continue
    const args = cmdline(pid)
    if (isClaude(args)) out.push({ pid, args: args!, cwd: cwdOf(pid) })
  }
  return out
}

export function stopSession(sessionId: string): { ok: true } | { error: string } {
  if (!SESSION_ID.test(sessionId)) return { error: 'No such session.' }
  const row = get<{ cwd: string | null; state: string }>('SELECT cwd, state FROM sessions WHERE id = ?', sessionId)
  if (!row) return { error: 'No such session.' }
  if (!fs.existsSync('/proc')) return { error: 'Stopping sessions only works on Linux and WSL for now.' }

  let target: { pid: number; group: boolean } | null = null
  const known = pids.get(sessionId)
  if (known && isClaude(cmdline(known.pid))) target = known
  if (!target) {
    const picked = pickProcess(sessionId, row.cwd, listClaude())
    if ('error' in picked) {
      // The process has already gone: nothing to stop, so they can just leave.
      if (!picked.gone) return { error: picked.error }
      setSessionState(sessionId, 'ended')
      return { ok: true }
    }
    target = { pid: picked.pid, group: false }
  }
  try {
    // Sessions HQ started run in their own process group, which also holds their shell commands.
    if (target.group) {
      try {
        process.kill(-target.pid, 'SIGTERM')
      } catch {
        process.kill(target.pid, 'SIGTERM')
      }
    } else process.kill(target.pid, 'SIGTERM')
  } catch {
    return { error: 'HQ was not allowed to stop that session.' }
  }
  pids.delete(sessionId)
  setSessionState(sessionId, 'ended')
  return { ok: true }
}
