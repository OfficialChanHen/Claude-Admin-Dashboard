import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

const spawned: { cmd: string; args: string[]; emitter: EventEmitter }[] = []
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn((cmd: string, args: string[]) => {
    const emitter = new EventEmitter() as EventEmitter & { unref: () => void }
    emitter.unref = vi.fn()
    spawned.push({ cmd, args, emitter })
    return emitter
  }),
}))
vi.mock('./db.js', () => ({ all: vi.fn(() => [{ id: 'p', name: 'p', path: '/work/p', aliases: '[]', color: 'sage', enabled: 1, hidden: 0, source: 'manual', github: null, dev_cmd: null, dev_port: null, prod_url: null, framework: null }]), get: vi.fn(), run: vi.fn() }))
vi.mock('./config.js', () => ({ SCAN_ROOTS: [] }))
vi.mock('./bus.js', () => ({ bus: { publish: vi.fn() } }))
vi.mock('./projectSettings.js', () => ({ writeProjectSettings: vi.fn() }))

const { openInVsCode } = await import('./projects.js')

describe('openInVsCode', () => {
  it('refuses a project that is not tracked', async () => {
    await expect(openInVsCode('nope')).rejects.toThrow('No such project.')
  })

  it('opens the project folder with the code command', async () => {
    const result = openInVsCode('p')
    const call = spawned.at(-1)!
    expect(call.cmd).toBe('code')
    expect(call.args).toEqual(['/work/p'])
    call.emitter.emit('spawn')
    await expect(result).resolves.toBeUndefined()
  })

  it('explains when the code command is not on PATH', async () => {
    const result = openInVsCode('p')
    const call = spawned.at(-1)!
    call.emitter.emit('error', Object.assign(new Error('spawn code ENOENT'), { code: 'ENOENT' }))
    await expect(result).rejects.toThrow('PATH')
  })
})
