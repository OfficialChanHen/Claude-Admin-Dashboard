import { describe, expect, it, vi } from 'vitest'

// The budget module reads the database and starts prompts; tests use stand-ins.
vi.mock('./db.js', () => ({ all: vi.fn(() => []), get: vi.fn(), run: vi.fn(() => ({ changes: 0 })) }))
vi.mock('./bus.js', () => ({ bus: { publish: vi.fn(), on: vi.fn() } }))
vi.mock('./limits.js', () => ({ getLimits: vi.fn(() => null) }))
vi.mock('./projects.js', () => ({ listProjects: vi.fn(() => []) }))
vi.mock('./prompt.js', () => ({ PERMISSION_MODES: ['acceptEdits', 'default', 'plan'], runningPrompts: vi.fn(() => []), startPrompt: vi.fn() }))
vi.mock('./config.js', () => ({
  ACTIVE_WINDOW_MS: 600_000,
  BUDGET: { on: true, wrapAt: 80, stopAt: 85, spareMs: 30 * 60_000, spareWrapAt: 95, spareStopAt: 99 },
}))

const { readBudget, Governor, canSpend } = await import('./budget.js')

const NOW = Date.parse('2026-10-20T12:00:00Z')
const at = (pct: number, minutesLeft: number) => ({ pct, resetsAt: new Date(NOW + minutesLeft * 60_000).toISOString() })

describe('readBudget', () => {
  it('wraps up at 80% and stops at 85%', () => {
    expect(readBudget(at(79, 120), NOW).phase).toBe('ok')
    expect(readBudget(at(80, 120), NOW).phase).toBe('wrap')
    expect(readBudget(at(84.9, 120), NOW).phase).toBe('wrap')
    expect(readBudget(at(85, 120), NOW).phase).toBe('stop')
  })

  it('lets the last half hour use what is left', () => {
    const r = readBudget(at(90, 25), NOW)
    expect(r).toMatchObject({ spare: true, phase: 'ok' })
    expect(readBudget(at(96, 25), NOW).phase).toBe('wrap')
    expect(readBudget(at(99, 25), NOW).phase).toBe('stop')
    expect(readBudget(at(50, 31), NOW).spare).toBe(false)
  })

  it('ignores numbers for a window that has reset', () => {
    expect(readBudget(at(100, -1), NOW)).toMatchObject({ phase: 'ok', pct: null })
  })

  it('still guards when the reset time is unknown', () => {
    expect(readBudget({ pct: 90, resetsAt: null }, NOW)).toMatchObject({ phase: 'stop', spare: false })
  })

  it('does nothing when turned off or without numbers', () => {
    expect(readBudget(at(99, 120), NOW, { on: false, wrapAt: 80, stopAt: 85, spareMs: 0, spareWrapAt: 95, spareStopAt: 99 }).phase).toBe('ok')
    expect(readBudget(null, NOW).phase).toBe('ok')
  })
})

function governor() {
  const store = { pause: vi.fn(), takeOver: vi.fn() }
  return { g: new Governor(store), store }
}
const ok = readBudget(at(50, 120), NOW)
const wrap = readBudget(at(81, 120), NOW)
const stop = readBudget(at(86, 120), NOW)
const s = 'sess-1'

describe('Governor', () => {
  it('says nothing under the limit', () => {
    const { g } = governor()
    expect(g.advise({ hook_event_name: 'PostToolUse', session_id: s }, ok)).toEqual({})
    expect(g.advise({ hook_event_name: 'PreToolUse', session_id: s }, ok)).toEqual({})
  })

  it('asks for a wrap-up once per window, and marks the session paused', () => {
    const { g, store } = governor()
    const first = g.advise({ hook_event_name: 'PostToolUse', session_id: s }, wrap) as { hookSpecificOutput: { additionalContext: string } }
    expect(first.hookSpecificOutput.additionalContext).toMatch(/81%.*Finish the step/)
    expect(store.pause).toHaveBeenCalledWith(s)
    expect(g.advise({ hook_event_name: 'PostToolUse', session_id: s }, wrap)).toEqual({})
    // Tools still run while wrapping up.
    expect(g.advise({ hook_event_name: 'PreToolUse', session_id: s }, wrap)).toEqual({})
  })

  it('refuses new steps past the stop mark, then ends the turn if it keeps trying', () => {
    const { g } = governor()
    for (let i = 0; i < 3; i++) {
      const r = g.advise({ hook_event_name: 'PreToolUse', session_id: s }, stop) as { hookSpecificOutput: { permissionDecision: string } }
      expect(r.hookSpecificOutput.permissionDecision).toBe('deny')
    }
    expect(g.advise({ hook_event_name: 'PreToolUse', session_id: s }, stop)).toMatchObject({ continue: false })
  })

  it('lets you carry on when you prompt past the limit', () => {
    const { g, store } = governor()
    const r = g.advise({ hook_event_name: 'UserPromptSubmit', session_id: s, prompt: 'keep going' }, stop)
    expect(r).toHaveProperty('hookSpecificOutput.additionalContext')
    expect(store.takeOver).toHaveBeenCalledWith(s)
    expect(g.advise({ hook_event_name: 'PreToolUse', session_id: s }, stop)).toEqual({})
  })

  it('gives no pass to automatic prompts or to work HQ started on spare usage', () => {
    const { g } = governor()
    g.advise({ hook_event_name: 'UserPromptSubmit', session_id: s, prompt: '<task-notification>done</task-notification>' }, stop)
    expect(g.advise({ hook_event_name: 'PreToolUse', session_id: s }, stop)).toHaveProperty('hookSpecificOutput.permissionDecision', 'deny')
    g.pilot.add('sess-2')
    g.advise({ hook_event_name: 'UserPromptSubmit', session_id: 'sess-2', prompt: 'finish it' }, stop)
    expect(g.advise({ hook_event_name: 'PreToolUse', session_id: 'sess-2' }, stop)).toHaveProperty('hookSpecificOutput.permissionDecision', 'deny')
  })

  it('a pass ends when the window resets', () => {
    const { g } = governor()
    g.advise({ hook_event_name: 'UserPromptSubmit', session_id: s, prompt: 'go on' }, stop)
    const later = readBudget({ pct: 86, resetsAt: new Date(NOW + 6 * 3600_000).toISOString() }, NOW)
    expect(g.advise({ hook_event_name: 'PreToolUse', session_id: s }, later)).toHaveProperty('hookSpecificOutput.permissionDecision', 'deny')
  })
})

describe('canSpend', () => {
  const spare = readBudget(at(60, 20), NOW)
  const fresh = { fetchedAt: NOW - 60_000 }
  it('spends only in the last half hour, on fresh numbers, with nobody working', () => {
    expect(canSpend(spare, fresh, false, NOW)).toBe(true)
    expect(canSpend(spare, fresh, true, NOW)).toBe(false)
    expect(canSpend(spare, { fetchedAt: NOW - 11 * 60_000 }, false, NOW)).toBe(false)
    expect(canSpend(ok, fresh, false, NOW)).toBe(false)
    expect(canSpend(readBudget(at(97, 20), NOW), fresh, false, NOW)).toBe(false)
  })
})
