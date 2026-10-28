import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const rows = [
  { project_id: 'a', day: '2026-10-27', model: 'opus', calls: 2, input: 10, output: 20, cache_read: 100, cache_write: 5, thinking: 3 },
  { project_id: 'a', day: '2026-10-27', model: 'haiku', calls: 1, input: 1, output: 2, cache_read: 0, cache_write: 0, thinking: 0 },
  { project_id: 'a', day: '2026-10-28', model: 'opus', calls: 1, input: 4, output: 4, cache_read: 0, cache_write: 0, thinking: 0 },
  { project_id: 'b', day: '2026-10-26', model: 'opus', calls: 1, input: 7, output: 0, cache_read: 0, cache_write: 0, thinking: 0 },
  { project_id: null, day: '2026-10-28', model: 'opus', calls: 1, input: 9, output: 0, cache_read: 0, cache_write: 0, thinking: 0 },
]
vi.mock('./db.js', () => ({ all: vi.fn(() => rows) }))
vi.mock('./config.js', () => ({ DATA_DIR: '/unused' }))
vi.mock('./projects.js', () => ({
  listProjects: () => [
    { id: 'a', name: 'Admin Dashboard' },
    { id: 'b', name: 'Hourelle' },
  ],
}))
// A flat price: one cent per token of any kind, whatever the model.
vi.mock('./usage.js', () => ({
  cost: (_m: string | null, t: { input: number; output: number; cacheRead: number; cacheWrite: number }) =>
    (t.input + t.output + t.cacheRead + t.cacheWrite) / 100,
}))

const { csvLine, dailyUsage, fileNames, writeUsageCsvs } = await import('./usageCsv.js')

describe('csvLine', () => {
  it('quotes fields with commas, quotes or line breaks', () => {
    expect(csvLine(['plain', 'a,b', 'say "hi"', 'two\nlines', 3])).toBe('plain,"a,b","say ""hi""","two\nlines",3')
  })
})

describe('dailyUsage', () => {
  it('gives one row per project, day and model', () => {
    const days = dailyUsage()
    expect(days.get('a')).toEqual([
      { day: '2026-10-27', model: 'haiku', calls: 1, input: 1, output: 2, cacheRead: 0, cacheWrite: 0, thinking: 0, total: 3, cost: 0.03 },
      { day: '2026-10-27', model: 'opus', calls: 2, input: 10, output: 20, cacheRead: 100, cacheWrite: 5, thinking: 3, total: 135, cost: 1.35 },
      { day: '2026-10-28', model: 'opus', calls: 1, input: 4, output: 4, cacheRead: 0, cacheWrite: 0, thinking: 0, total: 8, cost: 0.08 },
    ])
    expect(days.get('b')).toHaveLength(1)
    expect(days.get('')).toHaveLength(1)
  })
})

describe('fileNames', () => {
  it('names each file after its project and keeps names apart when two collide', () => {
    const names = fileNames([
      { id: 'x1', name: 'My App!' },
      { id: 'x2', name: 'my app' },
    ])
    expect(names.get('x1')).toBe('my-app.csv')
    expect(names.get('x2')).toBe('my-app-x2.csv')
  })
})

describe('writeUsageCsvs', () => {
  it('writes one file per project and one for every project together', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-csv-'))
    writeUsageCsvs(dir)
    expect(fs.readdirSync(dir).sort()).toEqual(['admin-dashboard.csv', 'all-projects.csv', 'hourelle.csv', 'no-project.csv'])
    const own = fs.readFileSync(path.join(dir, 'admin-dashboard.csv'), 'utf8').trim().split('\n')
    expect(own[0]).toBe('date,project,model,calls,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,thinking_tokens,total_tokens,cost_usd')
    expect(own[1]).toBe('2026-10-27,Admin Dashboard,haiku,1,1,2,0,0,0,3,0.030000')
    expect(own).toHaveLength(4)
    const every = fs.readFileSync(path.join(dir, 'all-projects.csv'), 'utf8').trim().split('\n')
    // Sorted by date, project and model, so it reads as a timeline.
    expect(every.slice(1).map((l) => l.split(',').slice(0, 3).join(','))).toEqual([
      '2026-10-26,Hourelle,opus',
      '2026-10-27,Admin Dashboard,haiku',
      '2026-10-27,Admin Dashboard,opus',
      '2026-10-28,(no project),opus',
      '2026-10-28,Admin Dashboard,opus',
    ])
  })
})
