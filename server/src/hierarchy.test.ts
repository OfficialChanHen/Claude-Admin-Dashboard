import { describe, expect, it, vi } from 'vitest'

// The module reads the database and starts prompts; these tests cover the rules and wording only.
vi.mock('./db.js', () => ({ all: vi.fn(() => []), get: vi.fn(), run: vi.fn(() => ({ changes: 0 })) }))
vi.mock('./bus.js', () => ({ bus: { publish: vi.fn(), on: vi.fn() } }))
vi.mock('./projects.js', () => ({ listProjects: vi.fn(() => []) }))
vi.mock('./usage.js', () => ({ activeSessions: vi.fn(() => []) }))
vi.mock('./prompt.js', () => ({ headlessSession: vi.fn(() => null), sessionTarget: vi.fn(), startPrompt: vi.fn() }))
vi.mock('./chat.js', () => ({ sessionChat: vi.fn(() => []) }))
vi.mock('./budget.js', () => ({ currentBudget: vi.fn(() => ({ phase: 'ok' })) }))
vi.mock('./config.js', () => ({ ACTIVE_WINDOW_MS: 600_000, DATA_DIR: '/tmp/hq-test', HIERARCHY: { on: true, everyMs: 600_000, promptsPerRound: 2 } }))

import { bossPrompt, formatDigest, managerPrompt, roundDue, sharedFiles, whoIsNeeded, type AgentDigest } from './hierarchy.js'

const a = (id: string, projectId: string | null) => ({ id, projectId })

describe('whoIsNeeded', () => {
  it('gives a project a manager once two agents work in it', () => {
    expect(whoIsNeeded([a('1', 'p'), a('2', 'q')], new Set()).managers).toEqual([])
    expect(whoIsNeeded([a('1', 'p'), a('2', 'p'), a('3', 'q')], new Set()).managers).toEqual(['p'])
  })

  it('brings in the boss once two projects have agents', () => {
    expect(whoIsNeeded([a('1', 'p'), a('2', 'p')], new Set()).boss).toBe(false)
    expect(whoIsNeeded([a('1', 'p'), a('2', 'q')], new Set()).boss).toBe(true)
  })

  it('does not count HQ’s own managers and boss, or folders outside a project', () => {
    const r = whoIsNeeded([a('1', 'p'), a('m', 'p'), a('2', null), a('3', 'q')], new Set(['m']))
    expect(r.managers).toEqual([])
    expect(r.boss).toBe(true)
  })
})

describe('roundDue', () => {
  const every = 10 * 60_000
  it('runs the first round straight away', () => {
    expect(roundDue(null, false, 0, 1000, every)).toBe(true)
  })
  it('waits for news, and for the gap', () => {
    expect(roundDue(0, false, 0, every * 2, every)).toBe(false) // nothing new
    expect(roundDue(0, false, 5, every - 1, every)).toBe(false) // too soon
    expect(roundDue(0, false, 5, every, every)).toBe(true)
  })
  it('never starts a second round while one runs', () => {
    expect(roundDue(null, true, 5, every * 5, every)).toBe(false)
  })
})

const d = (over: Partial<AgentDigest>): AgentDigest => ({
  id: 's1', title: 'Fix the camera', state: 'idle', lastAt: 0, asked: [], steps: 0, failed: 0, edited: [], helpers: [], lastReply: null, ...over,
})

describe('formatDigest', () => {
  it('says what each agent was asked, did and said, by name, with its session id for prompting', () => {
    const text = formatDigest([d({ asked: ['zoom out'], steps: 12, failed: 1, edited: ['camera.ts'], helpers: ['Explore the camera'], lastReply: 'Done.' })], 3 * 60_000)
    expect(text).toContain('Agent "Fix the camera" (idle, last active 3 min ago; session id for prompt_agent: s1)')
    expect(text).toContain('Asked: "zoom out"')
    expect(text).toContain('Did: 12 steps, 1 failed; edited camera.ts')
    expect(text).toContain('Its helpers: Explore the camera')
    expect(text).toContain('Last reply: Done.')
  })

  it('flags files two agents both edited', () => {
    const ds = [d({ id: 's1', title: 'A', edited: ['styles.css', 'a.ts'] }), d({ id: 's2', title: 'B', edited: ['styles.css'] })]
    expect(sharedFiles(ds)).toEqual([['styles.css', ['A', 'B']]])
    expect(formatDigest(ds, 0)).toContain('Files edited by more than one agent: styles.css (A, B)')
  })
})

describe('prompts', () => {
  it('puts a message from the boss on top of a manager’s round', () => {
    const p = managerPrompt('HQ', 'digest', true, 'Check the build')
    expect(p.startsWith('[A message from the boss]\nCheck the build')).toBe(true)
    expect(p).toContain('manager of the project "HQ"')
  })
  it('has a manager report to the boss, or to the user when there is no boss', () => {
    const withBoss = managerPrompt('HQ', 'digest', true)
    expect(withBoss).toContain('you report to the boss.')
    expect(withBoss).toContain('your summary for the boss')
    const alone = managerPrompt('HQ', 'digest', false)
    expect(alone).toContain('you report to the user.')
    expect(alone).toContain('your summary for the user')
    expect(alone).not.toContain('the boss')
  })
  it('tells both to finish with the report tool', () => {
    expect(managerPrompt('HQ', '', false)).toContain('calling report once')
    expect(bossPrompt('')).toContain('calling report once')
  })
  it('asks for a readable report: agents by name, bullets, and what needs the user', () => {
    for (const p of [managerPrompt('HQ', '', false), bossPrompt('')]) {
      expect(p).toContain('never by its session id')
      expect(p).toContain('**Needs you:**')
      expect(p).toContain('markdown bullets')
    }
  })
  it('gives a fresh session its last report, and a resumed one nothing extra', () => {
    expect(managerPrompt('HQ', 'digest', false, undefined, 'All quiet.')).toContain('Your last report, from before this fresh session:\n\nAll quiet.')
    expect(bossPrompt('news', 'Two projects busy.')).toContain('\nTwo projects busy.\n')
    expect(managerPrompt('HQ', 'digest', false)).not.toContain('fresh session')
    expect(bossPrompt('news')).not.toContain('fresh session')
  })
})
