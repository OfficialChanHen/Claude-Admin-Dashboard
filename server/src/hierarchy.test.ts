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

import { agentDone, bossPrompt, closingRoundDue, commitStates, managerDone, formatDigest, managerPrompt, mostlyDone, roundDue, sharedFiles, whoIsNeeded, type AgentDigest } from './hierarchy.js'

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
  it('waits for most of the rank below to be done, but not forever', () => {
    const maxWait = 45 * 60_000
    expect(roundDue(null, false, 0, 1000, every, false, 0, maxWait)).toBe(false) // first round, agents still busy
    expect(roundDue(0, false, 5, every, every, false, 0, maxWait)).toBe(false) // news, but agents still busy
    expect(roundDue(0, false, 5, every, every, true, 0, maxWait)).toBe(true)
    expect(roundDue(0, false, 5, maxWait, every, false, 0, maxWait)).toBe(true) // waited long enough
  })
})

describe('mostlyDone', () => {
  it('needs the given share of the rank below to be done', () => {
    expect(mostlyDone([true, false], 0.75)).toBe(false)
    expect(mostlyDone([true, true, true, false], 0.75)).toBe(true)
    expect(mostlyDone([], 0.75)).toBe(true)
  })
})

describe('agentDone', () => {
  it('counts an agent as done once it stopped working and has been quiet a moment', () => {
    expect(agentDone({ state: 'working', lastAt: 0 }, 120_000, 60_000)).toBe(false)
    expect(agentDone({ state: 'idle', lastAt: 100_000 }, 120_000, 60_000)).toBe(false)
    expect(agentDone({ state: 'idle', lastAt: 0 }, 120_000, 60_000)).toBe(true)
    expect(agentDone({ state: 'waiting', lastAt: 0 }, 120_000, 60_000)).toBe(true)
  })

  it('is not done while its helpers are still working, even if its own turn ended', () => {
    expect(agentDone({ state: 'idle', lastAt: 0 }, 120_000, 60_000, true)).toBe(false)
    expect(agentDone({ state: 'idle', lastAt: 0 }, 120_000, 60_000, false)).toBe(true)
  })
})

describe('managerDone', () => {
  const m = { running: false, reportedAt: 0, bossLastRound: null as number | null, latestWork: 0, agentsDone: false }

  it('is done once it reported since the boss last ran, even while its agents carry on', () => {
    // A busy project: an agent moved again seconds after the manager's report.
    expect(managerDone({ ...m, reportedAt: 1_000, bossLastRound: 500, latestWork: 1_006 })).toBe(true)
  })

  it('is not done before it has reported on work since the boss last ran', () => {
    expect(managerDone({ ...m, reportedAt: 400, bossLastRound: 500, latestWork: 1_006 })).toBe(false)
  })

  it('is done when its agents are done and it reported on their latest work', () => {
    expect(managerDone({ ...m, reportedAt: 1_000, bossLastRound: 2_000, latestWork: 900, agentsDone: true })).toBe(true)
  })

  it('is not done while it is in the middle of a round', () => {
    expect(managerDone({ ...m, running: true, reportedAt: 1_000, bossLastRound: 500, latestWork: 900, agentsDone: true })).toBe(false)
  })
})

describe('closingRoundDue', () => {
  const c = { wasNeeded: true, needed: false, running: false, lastRound: 1_000 as number | null, lastNews: 2_000 }

  it('runs once when the boss stops being needed and something happened since its last round', () => {
    expect(closingRoundDue(c)).toBe(true)
  })

  it('does not run while the boss is still needed or was not needed before', () => {
    expect(closingRoundDue({ ...c, needed: true })).toBe(false)
    expect(closingRoundDue({ ...c, wasNeeded: false })).toBe(false)
  })

  it('does not run with nothing new, mid-round, or before the boss ever ran', () => {
    expect(closingRoundDue({ ...c, lastNews: 900 })).toBe(false)
    expect(closingRoundDue({ ...c, running: true })).toBe(false)
    expect(closingRoundDue({ ...c, lastRound: null })).toBe(false)
  })
})

const d = (over: Partial<AgentDigest>): AgentDigest => ({
  id: 's1', title: 'Fix the camera', state: 'idle', lastAt: 0, asked: [], steps: 0, failed: 0, edited: [], helpers: [], lastReply: null,
  finished: true, committed: [], uncommitted: [], ...over,
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

describe('commitStates', () => {
  const work = {
    uncommitted: ['a.ts', 'shared.ts', 'mine-not.ts'],
    commits: [
      { subject: 'Fix the camera', files: ['cam.ts'], pushed: true },
      { subject: 'Tidy the hub', files: ['hub.ts', 'cam.ts'], pushed: false },
    ],
  }

  it('gives each agent the commits that touched its files and its files still uncommitted', () => {
    const s = commitStates([{ id: '1', edited: ['cam.ts', 'a.ts'], finished: true }], work)
    expect(s.get('1')).toEqual({
      committed: [{ subject: 'Fix the camera', pushed: true }, { subject: 'Tidy the hub', pushed: false }],
      uncommitted: ['a.ts'],
    })
  })

  it('leaves a file both a finished and a working agent edited with the one still working', () => {
    const s = commitStates([
      { id: 'done', edited: ['a.ts', 'shared.ts'], finished: true },
      { id: 'busy', edited: ['shared.ts'], finished: false },
    ], work)
    expect(s.get('done')!.uncommitted).toEqual(['a.ts'])
    expect(s.get('busy')!.uncommitted).toEqual(['shared.ts'])
  })

  it('has nothing for an agent whose files git does not show', () => {
    expect(commitStates([{ id: '1', edited: ['other.ts'], finished: true }], work).get('1')).toEqual({ committed: [], uncommitted: [] })
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

  it('tells the boss when a round is its closing one', () => {
    expect(bossPrompt('news', undefined, true)).toContain('closing round')
    expect(bossPrompt('news')).not.toContain('closing round')
  })
})

describe('formatDigest commit state', () => {
  it('says what each agent committed and whether the rest is ready to commit or still being finished', () => {
    const out = formatDigest([
      d({ title: 'Fix the camera', committed: [{ subject: 'Camera follows clicks', pushed: true }, { subject: 'Camera zoom', pushed: false }], uncommitted: ['cam.ts'] }),
      d({ id: 's2', title: 'Tidy the hub', state: 'working', finished: false, uncommitted: ['hub.ts'] }),
    ], 0)
    expect(out).toContain('  Committed: "Camera follows clicks" (pushed); "Camera zoom" (not pushed yet)')
    expect(out).toContain('  Not committed yet, ready to commit: cam.ts')
    expect(out).toContain('  Not committed yet, still being finished: hub.ts')
  })

  it('leaves the lines out when there is nothing to say', () => {
    const out = formatDigest([d({})], 0)
    expect(out).not.toContain('Committed:')
    expect(out).not.toContain('Not committed yet')
  })
})

describe('prompts commit state', () => {
  it('asks managers and the boss to say what is committed, ready to commit and still being finished', () => {
    for (const p of [managerPrompt('HQ', '', false), bossPrompt('')]) {
      expect(p).toContain('**Ready to commit:**')
      expect(p).toContain('**Still being finished:**')
      expect(p).toContain('committed')
    }
  })
})
