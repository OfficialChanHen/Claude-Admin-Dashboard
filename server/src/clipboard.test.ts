import { describe, expect, it, vi } from 'vitest'

// The plan logic is pure; the database is only touched by the queries around it.
vi.mock('./db.js', () => ({ all: vi.fn(), get: vi.fn(), run: vi.fn() }))

const { buildPlan, cleanNote, todoItems } = await import('./clipboard.js')
type Step = import('./clipboard.js').Step

const step = (text: string, status: Step['status'] = 'pending'): Step => ({ text, status, active: null })
const call = (id: string, ts: number, extra: Partial<{ doneTs: number | null; agentId: string; isError: boolean }> = {}) => ({
  id, description: `helper ${id}`, agentId: extra.agentId ?? null, agentType: 'Explore', ts, doneTs: extra.doneTs ?? null, isError: extra.isError ?? false,
})

describe('todoItems', () => {
  it('reads a TodoWrite call and skips what it cannot read', () => {
    expect(todoItems({ todos: [{ content: ' Fix login ', status: 'in_progress', activeForm: 'Fixing login' }, { content: '' }, { content: 'Ship', status: 'weird' }] }))
      .toEqual([{ text: 'Fix login', status: 'in_progress', active: 'Fixing login' }, { text: 'Ship', status: 'pending', active: null }])
    expect(todoItems({})).toBeNull()
  })
})

describe('buildPlan', () => {
  it('has nothing to show without a list', () => {
    expect(buildPlan([], [], new Map(), true)).toBeNull()
  })

  it('shows the latest list and puts each helper under the task in progress when it was sent', () => {
    const lists = [
      { ts: 10, items: [step('Read the code', 'in_progress'), step('Write the fix')] },
      { ts: 20, items: [step('Read the code', 'completed'), step('Write the fix', 'in_progress')] },
    ]
    const steps = new Map([['ag2', [step('Grep for login', 'completed')]]])
    const plan = buildPlan(lists, [call('c1', 12, { doneTs: 15 }), call('c2', 21, { agentId: 'ag2' })], steps, true)!
    expect(plan.tasks.map((t) => t.status)).toEqual(['completed', 'in_progress'])
    expect(plan.tasks[0].helpers).toMatchObject([{ id: 'c1', status: 'done' }])
    expect(plan.tasks[1].helpers).toMatchObject([{ id: 'c2', status: 'working', steps: [{ text: 'Grep for login' }] }])
    expect(plan.helpers).toEqual([])
  })

  it('keeps helpers sent while nothing was in progress apart', () => {
    const plan = buildPlan([{ ts: 10, items: [step('A')] }], [call('c1', 11)], new Map(), true)!
    expect(plan.helpers.map((h) => h.id)).toEqual(['c1'])
  })

  it('starts the plan where the to-do list was last replaced, leaving older helpers out', () => {
    const lists = [
      { ts: 10, items: [step('Old work', 'in_progress')] },
      { ts: 30, items: [step('New work', 'in_progress')] },
    ]
    const plan = buildPlan(lists, [call('old', 12), call('new', 31)], new Map(), true)!
    expect(plan.startedAt).toBe(30)
    expect(plan.tasks[0].helpers.map((h) => h.id)).toEqual(['new'])
    expect(plan.helpers).toEqual([])
  })

  it('marks helpers that never reported back as stopped once the session is over', () => {
    const plan = buildPlan([{ ts: 1, items: [step('A', 'in_progress')] }], [call('c1', 2), call('c2', 3, { doneTs: 4, isError: true })], new Map(), false)!
    expect(plan.tasks[0].helpers.map((h) => h.status)).toEqual(['stopped', 'failed'])
  })
})

describe('cleanNote', () => {
  it('needs some text, and not too much', () => {
    expect(cleanNote('  buy   milk ')).toBe('buy milk')
    expect(cleanNote('   ')).toEqual({ error: 'Write something first.' })
    expect(cleanNote('x'.repeat(501))).toMatchObject({ error: expect.any(String) })
  })
})
