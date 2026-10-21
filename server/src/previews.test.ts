import { describe, expect, it, vi } from 'vitest'

vi.mock('./bus.js', () => ({ bus: { publish: vi.fn() } }))
vi.mock('./projects.js', () => ({ listProjects: vi.fn(() => []), projectForCwd: vi.fn(() => null) }))
vi.mock('./config.js', () => ({ DATA_DIR: '/nonexistent', HOME: '/nonexistent' }))

const { devPorts, parseListeners, previewFile } = await import('./previews.js')

const SS = [
  'LISTEN 0      511        127.0.0.1:4318  0.0.0.0:* users:(("MainThread",pid=1962,fd=22))',
  'LISTEN 0      511                *:3000        *:* users:(("next-server",pid=500,fd=20))',
  'LISTEN 0      511            [::1]:5173     [::]:* users:(("node",pid=600,fd=21))',
  'LISTEN 0      4096       127.0.0.1:11434 0.0.0.0:*',
  '',
].join('\n')

describe('parseListeners', () => {
  it('reads ports and processes, and listens on loopback for any address', () => {
    expect(parseListeners(SS)).toEqual([
      { host: '127.0.0.1', port: 4318, pid: 1962 },
      { host: '127.0.0.1', port: 3000, pid: 500 },
      { host: '[::1]', port: 5173, pid: 600 },
    ])
  })
})

describe('devPorts', () => {
  const owner = (pid: number) => ({ 500: 'shop', 600: 'blog', 601: 'blog', 1962: 'hq' })[pid] ?? null
  const ls = [
    { host: '127.0.0.1', port: 3000, pid: 500 },
    { host: '127.0.0.1', port: 5174, pid: 601 },
    { host: '127.0.0.1', port: 5173, pid: 600 },
    { host: '127.0.0.1', port: 4318, pid: 1962 },
    { host: '127.0.0.1', port: 9999, pid: 777 },
  ]

  it('gives each project its lowest port, skipping processes that are not in a project', () => {
    const r = devPorts(ls, owner, new Map(), new Set())
    expect(r.get('shop')?.port).toBe(3000)
    expect(r.get('blog')?.port).toBe(5173)
    expect([...r.keys()].sort()).toEqual(['blog', 'hq', 'shop'])
  })

  it('prefers the dev port set for the project', () => {
    expect(devPorts(ls, owner, new Map([['blog', 5174]]), new Set()).get('blog')?.port).toBe(5174)
  })

  it('skips the processes it is told to', () => {
    expect(devPorts(ls, owner, new Map(), new Set([1962])).has('hq')).toBe(false)
  })
})

describe('previewFile', () => {
  it('only serves dev and prod pictures', () => {
    expect(previewFile('shop', '../../etc/passwd')).toBeNull()
    expect(previewFile('shop', 'dev')).toBeNull() // no picture taken yet
  })
})
