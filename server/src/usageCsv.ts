import fs from 'node:fs'
import path from 'node:path'
import { all } from './db.js'
import { DATA_DIR } from './config.js'
import { listProjects } from './projects.js'
import { cost } from './usage.js'

// Daily token use per project, written as plain CSV files for analysis in a
// spreadsheet or notebook. The files are rebuilt in full from the database
// each time, so they always hold the whole history and never drift.
export const CSV_DIR = process.env.HQ_CSV_DIR ?? path.join(DATA_DIR, 'usage-csv')
const EVERY_MS = 60 * 60 * 1000

const HEADER = ['date', 'project', 'model', 'calls', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'thinking_tokens', 'total_tokens', 'cost_usd']
const NO_PROJECT = '(no project)'

export type Day = {
  day: string; model: string; calls: number; input: number; output: number; cacheRead: number; cacheWrite: number; thinking: number; total: number; cost: number
}

export function csvLine(fields: (string | number)[]) {
  return fields.map((f) => {
    const s = String(f)
    return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
  }).join(',')
}

// One row per project, day and model. Days are local dates, like the rest of
// HQ. Cost is the same API value the usage panel shows, so the files and the
// app agree.
export function dailyUsage() {
  const rows = all<{ project_id: string | null; day: string; model: string | null; calls: number; input: number; output: number; cache_read: number; cache_write: number; thinking: number }>(
    `SELECT project_id, date(ts / 1000, 'unixepoch', 'localtime') day, model, COUNT(*) calls,
            SUM(input) input, SUM(output) output, SUM(cache_read) cache_read, SUM(cache_write) cache_write, SUM(thinking) thinking
     FROM requests GROUP BY 1, 2, 3`,
  )
  const out = new Map<string, Day[]>()
  for (const r of rows) {
    const key = r.project_id ?? ''
    const list = out.get(key) ?? []
    out.set(key, list)
    const t = { input: r.input, output: r.output, cacheRead: r.cache_read, cacheWrite: r.cache_write }
    list.push({
      day: r.day, model: r.model ?? 'unknown', calls: r.calls, ...t, thinking: r.thinking,
      total: r.input + r.output + r.cache_read + r.cache_write, cost: cost(r.model, t),
    })
  }
  for (const list of out.values()) list.sort((a, b) => a.day.localeCompare(b.day) || a.model.localeCompare(b.model))
  return out
}

// A file name from the project name, with the id added when two names match.
export function fileNames(projects: { id: string; name: string }[]) {
  const out = new Map<string, string>()
  const taken = new Set<string>()
  for (const p of projects) {
    let base = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project'
    if (taken.has(base)) base = `${base}-${p.id.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
    taken.add(base)
    out.set(p.id, `${base}.csv`)
  }
  return out
}

const line = (project: string, d: Day) =>
  csvLine([d.day, project, d.model, d.calls, d.input, d.output, d.cacheRead, d.cacheWrite, d.thinking, d.total, d.cost.toFixed(6)])

// Written beside the target and renamed over it, so a reader never sees half a file.
function writeFile(file: string, lines: string[]) {
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, [csvLine(HEADER), ...lines].join('\n') + '\n')
  fs.renameSync(tmp, file)
}

export function writeUsageCsvs(dir = CSV_DIR) {
  fs.mkdirSync(dir, { recursive: true })
  const days = dailyUsage()
  const projects = listProjects()
  const names = fileNames(projects)
  const label = new Map(projects.map((p) => [p.id, p.name]))
  const every: { day: string; project: string; model: string; text: string }[] = []
  const add = (id: string, name: string, file: string) => {
    const list = days.get(id)
    if (!list?.length) return
    writeFile(path.join(dir, file), list.map((d) => line(name, d)))
    for (const d of list) every.push({ day: d.day, project: name, model: d.model, text: line(name, d) })
  }
  for (const p of projects) add(p.id, p.name, names.get(p.id)!)
  add('', NO_PROJECT, 'no-project.csv')
  // Projects since hidden keep their history in the combined file.
  for (const [id, list] of days) {
    if (id && !label.has(id)) for (const d of list) every.push({ day: d.day, project: id, model: d.model, text: line(id, d) })
  }
  every.sort((a, b) => a.day.localeCompare(b.day) || a.project.localeCompare(b.project) || a.model.localeCompare(b.model))
  writeFile(path.join(dir, 'all-projects.csv'), every.map((e) => e.text))
}

export function startUsageCsv() {
  const round = () => {
    try {
      writeUsageCsvs()
    } catch (err) {
      console.warn('Usage CSV files could not be written:', err)
    }
  }
  round()
  setInterval(round, EVERY_MS).unref()
}
