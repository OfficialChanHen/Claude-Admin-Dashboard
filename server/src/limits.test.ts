import { describe, expect, it, vi } from 'vitest'

// The limits module saves to the database and announces on the bus; tests use stand-ins.
vi.mock('./db.js', () => ({ run: vi.fn() }))
vi.mock('./bus.js', () => ({ bus: { publish: vi.fn() } }))
vi.mock('./config.js', () => ({ CLAUDE_STATE: '/nonexistent', CLAUDE_CREDENTIALS: '/nonexistent' }))

const { fromUsage } = await import('./limits.js')

describe('fromUsage', () => {
  it('reads the windows and the breakdown', () => {
    const l = fromUsage(
      {
        five_hour: { utilization: 42, resets_at: '2026-10-20T18:00:00Z' },
        seven_day: { utilization: 12.5, resets_at: '2026-10-25T00:00:00Z' },
        seven_day_opus: { utilization: null, resets_at: null },
        seven_day_breakdown: { rows: [{ key: 'opus', display_name: 'Opus', percent: 9 }] },
        extra_usage: { is_enabled: true },
      },
      1000,
      'api',
    )
    expect(l).toEqual({
      fetchedAt: 1000,
      source: 'api',
      fiveHour: { pct: 42, resetsAt: '2026-10-20T18:00:00Z' },
      sevenDay: { pct: 12.5, resetsAt: '2026-10-25T00:00:00Z' },
      sevenDayOpus: null,
      sevenDaySonnet: null,
      breakdown: [{ key: 'opus', name: 'Opus', pct: 9 }],
      extraUsage: true,
    })
  })

  it('ignores a reply with no windows in it', () => {
    expect(fromUsage({}, 1000, 'api')).toBeNull()
    expect(fromUsage(null as never, 1000, 'api')).toBeNull()
  })
})
