import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DATA_DIR, HOME } from './config.js'
import { bus } from './bus.js'
import { listProjects, projectForCwd } from './projects.js'

const exec = promisify(execFile)

// The TV in each room: a picture of the project's dev server while one is
// running, and of its live site. Dev servers are found by what is listening on
// a port and which folder that process runs in, so any port works. Pictures
// are taken with a headless Chromium on this machine, a few minutes apart, so
// they cost nothing but a little CPU.

export type Shot = { url: string; shotAt: number | null }
export type Preview = { projectId: string; dev: (Shot & { port: number }) | null; prod: Shot | null }

const SCAN_MS = 20_000
const DEV_EVERY_MS = 2 * 60_000
const PROD_EVERY_MS = 30 * 60_000
const SHOT_DIR = path.join(DATA_DIR, 'previews')

export type Listener = { host: string; port: number; pid: number }

/** Reads `ss -ltnpH`: who listens on which port. Lines without a process are skipped. */
export function parseListeners(out: string): Listener[] {
  const list: Listener[] = []
  for (const line of out.split('\n')) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 5) continue
    const local = cols[3]
    const i = local.lastIndexOf(':')
    const port = Number(local.slice(i + 1))
    const pid = Number(line.match(/pid=(\d+)/)?.[1])
    if (!port || !pid) continue
    let host = local.slice(0, i).replace(/%.*$/, '')
    if (host === '*' || host === '0.0.0.0' || host === '[::]') host = '127.0.0.1'
    list.push({ host, port, pid })
  }
  return list
}

/**
 * The port to show for each project: its own dev port when that is listening,
 * otherwise its lowest. `owner` says which project a process belongs to.
 */
export function devPorts(listeners: Listener[], owner: (pid: number) => string | null, preferred: Map<string, number | null>, skip: Set<number>) {
  const by = new Map<string, Listener[]>()
  for (const l of listeners) {
    if (skip.has(l.pid)) continue
    const id = owner(l.pid)
    if (!id) continue
    by.set(id, [...(by.get(id) ?? []), l])
  }
  const out = new Map<string, Listener>()
  for (const [id, ls] of by) {
    const want = preferred.get(id)
    out.set(id, ls.find((l) => l.port === want) ?? [...ls].sort((a, b) => a.port - b.port)[0])
  }
  return out
}

/** The headless Chromium Playwright keeps in its cache, or HQ_CHROME. */
function chrome(): string | null {
  if (process.env.HQ_CHROME) return process.env.HQ_CHROME
  const root = path.join(HOME, '.cache', 'ms-playwright')
  try {
    for (const d of fs.readdirSync(root).filter((n) => n.startsWith('chromium_headless_shell-')).sort().reverse()) {
      const bin = path.join(root, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell')
      if (fs.existsSync(bin)) return bin
    }
  } catch {
    // no cache
  }
  return null
}

const state = new Map<string, Preview>()
let busy = false

function file(projectId: string, which: 'dev' | 'prod') {
  return path.join(SHOT_DIR, `${projectId.replace(/[^a-z0-9-]/gi, '_')}-${which}.png`)
}

export function previewFile(projectId: string, which: string) {
  if (which !== 'dev' && which !== 'prod') return null
  const f = file(projectId, which)
  return fs.existsSync(f) ? f : null
}

export function previewState(): Preview[] {
  return [...state.values()]
}

async function shoot(url: string, out: string) {
  const bin = chrome()
  if (!bin) return false
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  const tmp = `${out}.tmp.png`
  const libs = path.join(HOME, '.cache', 'aline-verify-libs')
  const env = { ...process.env, LD_LIBRARY_PATH: [fs.existsSync(libs) ? libs : '', process.env.LD_LIBRARY_PATH ?? ''].filter(Boolean).join(':') }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-shot-'))
  try {
    await exec(bin, [
      '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--mute-audio', `--user-data-dir=${profile}`,
      '--window-size=1280,800', '--force-device-scale-factor=0.5', '--virtual-time-budget=6000',
      `--screenshot=${tmp}`, url,
    ], { env, timeout: 45_000 })
    if (!fs.existsSync(tmp)) return false
    fs.renameSync(tmp, out)
    return true
  } catch {
    fs.rmSync(tmp, { force: true })
    return false
  } finally {
    fs.rmSync(profile, { recursive: true, force: true })
  }
}

/** A page answers with HTML: a dev server, not an API or a database. */
async function servesPage(url: string) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000), redirect: 'follow' })
    return (res.headers.get('content-type') ?? '').includes('text/html')
  } catch {
    return false
  }
}

function cwdOf(pid: number) {
  try {
    return fs.readlinkSync(`/proc/${pid}/cwd`)
  } catch {
    return null
  }
}

async function scan() {
  if (busy) return
  busy = true
  try {
    const projects = listProjects().filter((p) => p.enabled)
    let out = ''
    try {
      out = (await exec('ss', ['-ltnpH'], { timeout: 5000 })).stdout
    } catch {
      // no ss: no dev previews
    }
    const ports = devPorts(parseListeners(out), (pid) => projectForCwd(cwdOf(pid)), new Map(projects.map((p) => [p.id, p.devPort])), new Set([process.pid]))
    let changed = false
    const now = Date.now()
    for (const p of projects) {
      const was = state.get(p.id)
      const l = ports.get(p.id)
      let dev: Preview['dev'] = null
      if (l) {
        const probe = `http://${l.host}:${l.port}/`
        if (await servesPage(probe)) dev = { url: `http://localhost:${l.port}/`, port: l.port, shotAt: was?.dev?.port === l.port ? was.dev.shotAt : null }
        if (dev && (!dev.shotAt || now - dev.shotAt > DEV_EVERY_MS) && (await shoot(probe, file(p.id, 'dev')))) dev.shotAt = Date.now()
      }
      let prod: Preview['prod'] = null
      if (p.prodUrl) {
        prod = { url: p.prodUrl, shotAt: was?.prod?.url === p.prodUrl ? was.prod.shotAt : null }
        if ((!prod.shotAt || now - prod.shotAt > PROD_EVERY_MS) && (await shoot(p.prodUrl, file(p.id, 'prod')))) prod.shotAt = Date.now()
      }
      if (!dev && !prod) {
        if (was) changed = true
        state.delete(p.id)
        continue
      }
      const next = { projectId: p.id, dev, prod }
      if (JSON.stringify(next) !== JSON.stringify(was)) changed = true
      state.set(p.id, next)
    }
    for (const id of state.keys()) if (!projects.some((p) => p.id === id)) state.delete(id)
    if (changed) bus.publish({ kind: 'previews' })
  } finally {
    busy = false
  }
}

export function startPreviews() {
  scan()
  setInterval(scan, SCAN_MS).unref()
}
