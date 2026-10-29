import { describe, expect, it, vi } from 'vitest'

vi.mock('./db.js', () => ({ get: vi.fn(), run: vi.fn(), all: vi.fn(() => []), tx: vi.fn((f: () => void) => f()) }))

const { stateFor } = await import('./hooks.js')

describe('stateFor', () => {
  it('maps hook events to session states', () => {
    expect(stateFor({ hook_event_name: 'UserPromptSubmit' }, false)).toBe('working')
    expect(stateFor({ hook_event_name: 'Stop' }, false)).toBe('idle')
    expect(stateFor({ hook_event_name: 'SessionEnd' }, false)).toBe('ended')
  })

  it('keeps a session HQ ran at its desk when its turn ends, so you can reply', () => {
    expect(stateFor({ hook_event_name: 'SessionEnd' }, true)).toBe('idle')
  })

  it('reads permission and idle notifications', () => {
    expect(stateFor({ hook_event_name: 'Notification', notification_type: 'permission_prompt' }, false)).toBe('waiting')
    expect(stateFor({ hook_event_name: 'Notification', message: 'Claude is waiting for your input' }, false)).toBe('idle')
    expect(stateFor({ hook_event_name: 'Notification', message: 'hello' }, false)).toBeUndefined()
  })
})
