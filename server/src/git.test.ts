import { describe, expect, it, vi } from 'vitest'

vi.mock('./db.js', () => ({ all: vi.fn(() => []) }))
vi.mock('./bus.js', () => ({ bus: { publish: vi.fn() } }))
vi.mock('./projects.js', () => ({ listProjects: vi.fn(() => []) }))

const { changesBetween, parseShortstat, parseStatus, reflogKind } = await import('./git.js')

describe('parseStatus', () => {
  it('reads the commit, branch, upstream, ahead count and changed files', () => {
    const out = [
      '# branch.oid 5189e20aa',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 aaa bbb web/src/App.tsx',
      '? web/src/world/new.ts',
      '',
    ].join('\n')
    expect(parseStatus(out)).toEqual({ head: '5189e20aa', branch: 'main', upstream: 'origin/main', ahead: 2, files: 2 })
  })

  it('has no head before the first commit and no ahead count without an upstream', () => {
    expect(parseStatus('# branch.oid (initial)\n# branch.head main\n')).toEqual({ head: null, branch: 'main', upstream: null, ahead: null, files: 0 })
  })

  it('treats a detached head as no branch', () => {
    expect(parseStatus('# branch.oid abc\n# branch.head (detached)\n').branch).toBeNull()
  })
})

describe('parseShortstat', () => {
  it('reads lines added and removed', () => {
    expect(parseShortstat(' 3 files changed, 10 insertions(+), 2 deletions(-)\n')).toEqual({ added: 10, removed: 2 })
    expect(parseShortstat(' 1 file changed, 1 insertion(+)\n')).toEqual({ added: 1, removed: 0 })
    expect(parseShortstat('')).toEqual({ added: 0, removed: 0 })
  })
})

describe('reflogKind', () => {
  it('tells commits and pushes from pulls and checkouts', () => {
    expect(reflogKind('commit: Add the TV')).toBe('commit')
    expect(reflogKind('commit (amend): Fix it')).toBe('commit')
    expect(reflogKind('commit (initial): First')).toBe('commit')
    expect(reflogKind('update by push')).toBe('push')
    expect(reflogKind('pull: Fast-forward')).toBe('other')
    expect(reflogKind('checkout: moving from main to x')).toBe('other')
    expect(reflogKind('reset: moving to HEAD~1')).toBe('other')
  })
})

describe('changesBetween', () => {
  const at = (head: string | null, upstreamTip: string | null = null) => ({ head, upstreamTip })

  it('sees nothing on the first look', () => {
    expect(changesBetween('p', undefined, at('b'), 'commit: x', '', 'x')).toEqual([])
  })

  it('sees a commit when HEAD moved by a commit', () => {
    expect(changesBetween('p', at('a'), at('b'), 'commit: Ship it', '', 'Ship it')).toEqual([{ projectId: 'p', change: 'commit', subject: 'Ship it' }])
  })

  it('ignores HEAD moving by a pull or checkout', () => {
    expect(changesBetween('p', at('a'), at('b'), 'pull: Fast-forward', '', null)).toEqual([])
    expect(changesBetween('p', at('a'), at('b'), 'checkout: moving from a to b', '', null)).toEqual([])
  })

  it('sees a push when the upstream moved by a push, and not by a fetch', () => {
    expect(changesBetween('p', at('b', 'a'), at('b', 'b'), '', 'update by push', 's')).toEqual([{ projectId: 'p', change: 'push', subject: 's' }])
    expect(changesBetween('p', at('b', 'a'), at('b', 'c'), '', 'fetch: fast-forward', 's')).toEqual([])
  })

  it('sees a commit and a push made between two looks', () => {
    const r = changesBetween('p', at('a', 'a'), at('b', 'b'), 'commit: x', 'update by push', 'x')
    expect(r.map((c) => c.change)).toEqual(['commit', 'push'])
  })
})
