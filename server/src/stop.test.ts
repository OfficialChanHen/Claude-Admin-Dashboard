import { describe, expect, it, vi } from 'vitest'

vi.mock('./db.js', () => ({ get: vi.fn(), run: vi.fn(), all: vi.fn(() => []), tx: vi.fn((f: () => void) => f()) }))

const { isClaude, pickProcess } = await import('./stop.js')

const SID = '0b7e2f4c-1a2b-4c3d-8e9f-001122334455'

describe('isClaude', () => {
  it('knows the CLI however it was started', () => {
    expect(isClaude(['claude'])).toBe(true)
    expect(isClaude(['claude', '-p', '--resume', SID])).toBe(true)
    expect(isClaude(['/home/me/.local/bin/claude', '--continue'])).toBe(true)
    expect(isClaude(['node', '/usr/lib/node_modules/@anthropic-ai/claude-code/cli.js'])).toBe(true)
  })

  it('leaves everything else alone, this app included', () => {
    expect(isClaude(['node', '/home/me/Programming/Claude/Admin Dashboard/server/src/index.ts'])).toBe(false)
    expect(isClaude(['bash'])).toBe(false)
    expect(isClaude([])).toBe(false)
    expect(isClaude(null)).toBe(false)
  })
})

describe('pickProcess', () => {
  const p = (pid: number, cwd: string, ...args: string[]) => ({ pid, cwd, args: ['claude', ...args] })

  it('prefers the process started for that session', () => {
    expect(pickProcess(SID, '/a', [p(10, '/a'), p(11, '/a', '--resume', SID)])).toEqual({ pid: 11 })
  })

  it('uses the only claude in the folder', () => {
    expect(pickProcess(SID, '/a', [p(10, '/a'), p(12, '/b'), { pid: 13, cwd: '/a', args: ['vim'] }])).toEqual({ pid: 10 })
  })

  it('says so when nothing is running there', () => {
    expect(pickProcess(SID, '/a', [p(12, '/b')])).toMatchObject({ gone: true })
  })

  it('refuses to guess between two sessions in one folder', () => {
    expect(pickProcess(SID, '/a', [p(10, '/a'), p(11, '/a')])).toMatchObject({ gone: false })
  })
})
