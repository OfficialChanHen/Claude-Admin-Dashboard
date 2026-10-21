import { afterEach, describe, expect, it, vi } from 'vitest'
import { Approvals, describeInput, hookReply, type ApprovalEvent } from './approvals.js'

const req = { sessionId: 's1', projectId: 'p1', tool: 'Bash', summary: 'List files', detail: 'ls' }

function setup(waitMs = 1000) {
  const events: ApprovalEvent[] = []
  const a = new Approvals((ev) => events.push(ev), waitMs)
  a.viewers = 1
  return { a, events }
}

afterEach(() => vi.useRealTimers())

describe('Approvals', () => {
  it('does not hold a request when nobody has HQ open', async () => {
    const { a, events } = setup()
    a.viewers = 0
    const r = a.ask(req)
    expect(r.id).toBeNull()
    expect(await r.decision).toBeNull()
    expect(events).toEqual([])
  })

  it('waits for your answer and announces it', async () => {
    const { a, events } = setup()
    const r = a.ask(req)
    expect(a.list()).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'approval', approval: { tool: 'Bash', sessionId: 's1' } })
    expect(a.decide(r.id!, 'allow')).toBe(true)
    expect(await r.decision).toBe('allow')
    expect(a.list()).toEqual([])
    expect(events[1]).toEqual({ kind: 'approval_done', id: r.id, decision: 'allow' })
  })

  it('answers only once', async () => {
    const { a } = setup()
    const r = a.ask(req)
    a.decide(r.id!, 'deny')
    expect(a.decide(r.id!, 'allow')).toBe(false)
    expect(await r.decision).toBe('deny')
  })

  it('hands back to the terminal when time runs out', async () => {
    vi.useFakeTimers()
    const { a, events } = setup(5000)
    const r = a.ask(req)
    vi.advanceTimersByTime(5000)
    expect(await r.decision).toBeNull()
    expect(events.at(-1)).toMatchObject({ kind: 'approval_done', decision: null })
  })

  it('can hold one request for less time, as sessions HQ started need', async () => {
    vi.useFakeTimers()
    const { a } = setup(120_000)
    const r = a.ask(req, Date.now(), 50_000)
    expect(a.list()[0].expiresAt - a.list()[0].ts).toBe(50_000)
    vi.advanceTimersByTime(50_000)
    expect(await r.decision).toBeNull()
  })

  it('lets go of a session that moved on', async () => {
    const { a } = setup()
    const r1 = a.ask(req)
    const r2 = a.ask({ ...req, sessionId: 's2' })
    a.dropSession('s1')
    expect(await r1.decision).toBeNull()
    expect(a.list().map((x) => x.id)).toEqual([r2.id])
  })
})

describe('hookReply', () => {
  it('says nothing without a decision, so Claude Code asks as usual', () => {
    expect(hookReply(null)).toEqual({})
  })

  it('allows and denies in the PermissionRequest shape', () => {
    expect(hookReply('allow')).toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } })
    expect(hookReply('deny')).toMatchObject({ hookSpecificOutput: { decision: { behavior: 'deny' } } })
  })
})

describe('describeInput', () => {
  it('shows the whole command', () => {
    expect(describeInput('Bash', { command: 'rm -rf build', description: 'Clean' })).toBe('rm -rf build')
  })

  it('shows an edit as before and after', () => {
    expect(describeInput('Edit', { file_path: '/a.ts', old_string: 'x', new_string: 'y' })).toBe('/a.ts\n\n- x\n+ y')
  })

  it('cuts very long input', () => {
    expect(describeInput('Bash', { command: 'x'.repeat(5000) })).toHaveLength(2000)
  })
})
