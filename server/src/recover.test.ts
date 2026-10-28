import { describe, expect, it, vi } from 'vitest'

// The recovery module reads the database and starts prompts; tests use stand-ins.
vi.mock('./db.js', () => ({ all: vi.fn(() => []), get: vi.fn(), run: vi.fn(() => ({ changes: 0 })) }))
vi.mock('./prompt.js', () => ({ adoptTask: vi.fn(), startPrompt: vi.fn(), PERMISSION_MODES: ['acceptEdits', 'default', 'plan'] }))
vi.mock('./stop.js', () => ({ isRunning: vi.fn(() => false) }))
vi.mock('./budget.js', () => ({ currentBudget: vi.fn(() => ({ phase: 'ok' })) }))

const { decideRecovery, RECOVER_MAX_AGE_MS } = await import('./recover.js')

const NOW = Date.parse('2026-10-28T12:00:00Z')
// A task cut off mid-step an hour ago, with nothing standing in the way of resuming it.
const cutOff = { startedAt: NOW - 3600_000, recovered: false, role: false, alive: false, state: 'working', paused: false, budgetOk: true }

describe('decideRecovery', () => {
  it('takes back a task whose process is still running', () => {
    expect(decideRecovery({ ...cutOff, alive: true }, NOW)).toBe('reclaim')
  })

  it('takes back a live manager too, so Stop and approvals work for it', () => {
    expect(decideRecovery({ ...cutOff, alive: true, role: true }, NOW)).toBe('reclaim')
  })

  it('resumes a task that was cut off mid-step', () => {
    expect(decideRecovery(cutOff, NOW)).toBe('resume')
    expect(decideRecovery({ ...cutOff, state: 'waiting' }, NOW)).toBe('resume')
  })

  it('leaves a task that finished while HQ was down', () => {
    expect(decideRecovery({ ...cutOff, state: 'idle' }, NOW)).toBe('leave')
    expect(decideRecovery({ ...cutOff, state: 'ended' }, NOW)).toBe('leave')
    expect(decideRecovery({ ...cutOff, state: null }, NOW)).toBe('leave')
  })

  it('resumes a task at most once', () => {
    expect(decideRecovery({ ...cutOff, recovered: true }, NOW)).toBe('leave')
  })

  it('leaves tasks older than about 6 hours', () => {
    expect(decideRecovery({ ...cutOff, startedAt: NOW - RECOVER_MAX_AGE_MS + 60_000 }, NOW)).toBe('resume')
    expect(decideRecovery({ ...cutOff, startedAt: NOW - RECOVER_MAX_AGE_MS - 60_000 }, NOW)).toBe('leave')
  })

  it('leaves managers and the boss for their next round', () => {
    expect(decideRecovery({ ...cutOff, role: true }, NOW)).toBe('leave')
  })

  it('resumes nothing while the 5 hour budget is holding work back', () => {
    expect(decideRecovery({ ...cutOff, paused: true }, NOW)).toBe('leave')
    expect(decideRecovery({ ...cutOff, budgetOk: false }, NOW)).toBe('leave')
  })
})
