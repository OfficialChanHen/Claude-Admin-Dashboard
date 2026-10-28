import fs from 'node:fs'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { all, get, run } from './db.js'
import { SCAN_ROOTS } from './config.js'
import { bus } from './bus.js'
import { writeProjectSettings } from './projectSettings.js'

const exec = promisify(execFile)

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

// Zone colours for the world map. Keys map to CSS tokens in the web app.
const COLORS = ['sage', 'clay', 'sky', 'wheat', 'plum', 'fern', 'rose', 'stone']
const SKIP = new Set(['node_modules', '.next', 'dist', 'build', '.venv', 'venv', '__pycache__', '.cache', 'worktrees'])

type ProjectRow = {
  id: string; name: string; path: string; aliases: string; color: string | null; enabled: number
  hidden: number; source: string; github: string | null; dev_cmd: string | null; dev_port: number | null
  prod_url: string | null; framework: string | null
}

function toProject(r: ProjectRow): Project {
  return {
    id: r.id,
    name: r.name,
    path: r.path,
    aliases: JSON.parse(r.aliases),
    color: r.color ?? 'stone',
    enabled: !!r.enabled,
    source: r.source as Project['source'],
    github: r.github,
    devCmd: r.dev_cmd,
    devPort: r.dev_port,
    prodUrl: r.prod_url,
    framework: r.framework,
  }
}

let cache: Project[] | null = null
let matchCache: { id: string; path: string }[] | null = null

export function listProjects(): Project[] {
  if (!cache) {
    cache = all<ProjectRow>('SELECT * FROM projects WHERE hidden = 0 ORDER BY name COLLATE NOCASE').map(toProject)
  }
  return cache
}

function changed() {
  cache = null
  matchCache = null
  bus.publish({ kind: 'projects' })
}

// Longest matching project path wins, so worktrees inside a repo map to that repo.
// Removed projects still match, so their history keeps its owner.
export function projectForCwd(cwd: string | null | undefined): string | null {
  if (!cwd) return null
  matchCache ??= all<{ id: string; path: string }>('SELECT id, path FROM projects')
  let best: { id: string; path: string } | null = null
  for (const p of matchCache) {
    if (cwd === p.path || cwd.startsWith(p.path + '/')) {
      if (!best || p.path.length > best.path.length) best = p
    }
  }
  return best?.id ?? null
}

function findRepos(root: string, depth: number, out: string[]) {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  if (entries.some((e) => e.name === '.git')) {
    out.push(root)
    return
  }
  if (depth === 0) return
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || SKIP.has(e.name)) continue
    findRepos(path.join(root, e.name), depth - 1, out)
  }
}

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project'
}

function uniqueId(base: string) {
  let id = base
  for (let n = 2; get('SELECT 1 FROM projects WHERE id = ?', id); n++) id = `${base}-${n}`
  return id
}

async function inspect(dir: string) {
  const has = (f: string) => fs.existsSync(path.join(dir, f))
  let devCmd: string | null = null
  let framework: string | null = null
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    if (pkg.scripts?.dev) devCmd = 'npm run dev'
    framework = deps.next ? 'next' : deps.vite ? 'vite' : deps.react ? 'react' : 'node'
  } catch {
    if (has('pyproject.toml') || has('requirements.txt') || fs.readdirSync(dir).some((f) => f.endsWith('.py'))) {
      framework = 'python'
    }
  }
  let github: string | null = null
  try {
    const { stdout } = await exec('git', ['-C', dir, 'remote', 'get-url', 'origin'])
    const m = stdout.trim().match(/github\.com[:/](.+?)(?:\.git)?$/)
    github = m ? m[1] : null
  } catch {
    // no remote
  }
  return { devCmd, framework, github }
}

// A project HQ tracks gets HQ's permissions in its own .claude/settings.local.json.
// A folder that can't be written to is still added.
function tryProjectSettings(dir: string) {
  try {
    writeProjectSettings(dir)
  } catch {
    // read-only or gone; the project just keeps asking
  }
}

export async function addProject(dir: string, source: 'scan' | 'manual' = 'manual'): Promise<Project> {
  const abs = path.resolve(dir)
  if (!fs.statSync(abs).isDirectory()) throw new Error('Not a folder')
  const existing = get<ProjectRow>('SELECT * FROM projects WHERE path = ?', abs)
  if (existing) {
    // Re-adding something that was removed brings it back.
    if (existing.hidden && source === 'manual') {
      run('UPDATE projects SET hidden = 0 WHERE id = ?', existing.id)
      tryProjectSettings(abs)
      changed()
    }
    return toProject({ ...existing, hidden: 0 })
  }
  const info = await inspect(abs)
  const count = (get<{ n: number }>('SELECT COUNT(*) n FROM projects')?.n ?? 0) as number
  const id = uniqueId(slug(path.basename(abs)))
  run(
    `INSERT INTO projects (id, name, path, aliases, color, enabled, source, github, dev_cmd, framework, added_at)
     VALUES (?, ?, ?, '[]', ?, 1, ?, ?, ?, ?, ?)`,
    id, path.basename(abs), abs, COLORS[count % COLORS.length], source, info.github, info.devCmd, info.framework, Date.now(),
  )
  tryProjectSettings(abs)
  changed()
  return listProjects().find((p) => p.id === id)!
}

// New repos get added. Ones the user removed stay removed.
export async function scanProjects(roots = SCAN_ROOTS) {
  const found: string[] = []
  for (const r of roots) findRepos(r, 4, found)
  for (const dir of found) {
    if (!get('SELECT 1 FROM projects WHERE path = ?', dir)) await addProject(dir, 'scan')
  }
  assignDevPorts()
  return listProjects()
}

// Every Next app defaults to 3000, so each project gets its own port.
function assignDevPorts() {
  const rows = all<{ id: string; dev_port: number | null }>(
    'SELECT id, dev_port FROM projects WHERE dev_cmd IS NOT NULL ORDER BY added_at',
  )
  const used = new Set(rows.map((r) => r.dev_port).filter(Boolean))
  let next = 3101
  for (const r of rows) {
    if (r.dev_port) continue
    while (used.has(next)) next++
    run('UPDATE projects SET dev_port = ? WHERE id = ?', next, r.id)
    used.add(next)
  }
  changed()
}

export function updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'aliases' | 'color' | 'enabled' | 'prodUrl' | 'devCmd' | 'devPort'>>) {
  const cols: Record<string, unknown> = {}
  if (patch.name !== undefined) cols.name = patch.name
  if (patch.aliases !== undefined) cols.aliases = JSON.stringify(patch.aliases)
  if (patch.color !== undefined) cols.color = patch.color
  if (patch.enabled !== undefined) cols.enabled = patch.enabled ? 1 : 0
  if (patch.prodUrl !== undefined) cols.prod_url = patch.prodUrl || null
  if (patch.devCmd !== undefined) cols.dev_cmd = patch.devCmd || null
  if (patch.devPort !== undefined) cols.dev_port = patch.devPort || null
  const keys = Object.keys(cols)
  if (keys.length) {
    run(`UPDATE projects SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => cols[k]), id)
    changed()
  }
  return listProjects().find((p) => p.id === id)
}

// Removing hides the project so a rescan doesn't bring it back. History is kept.
export function removeProject(id: string) {
  run('UPDATE projects SET hidden = 1 WHERE id = ?', id)
  changed()
}

// `code` picks up WSL automatically when run from inside it; no remote flag needed.
export async function openInVsCode(id: string): Promise<void> {
  const p = listProjects().find((pr) => pr.id === id)
  if (!p) throw new Error('No such project.')
  return new Promise((resolve, reject) => {
    const child = spawn('code', [p.path], { detached: true, stdio: 'ignore' })
    child.once('error', (err: NodeJS.ErrnoException) =>
      reject(new Error(err.code === 'ENOENT' ? 'VS Code\'s "code" command isn\'t on your PATH.' : err.message)),
    )
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
