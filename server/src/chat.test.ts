import { describe, expect, it, vi } from 'vitest'

// The log reader shares helpers with the transcript module, which opens the database; tests use a stand-in.
vi.mock('./db.js', () => ({ get: vi.fn(), run: vi.fn(), all: vi.fn(() => []), tx: vi.fn((f: () => void) => f()) }))

const { chatFromLines } = await import('./chat.js')

const SID = 'sess-1'
const line = (o: object) => JSON.stringify(o)
const t = (s: number) => new Date(Date.UTC(2026, 9, 20, 12, 0, s)).toISOString()

describe('chatFromLines', () => {
  it('reads what you asked, what Claude said and the steps between', () => {
    const lines = [
      line({ type: 'user', timestamp: t(0), message: { content: 'fix the login' } }),
      line({ type: 'assistant', timestamp: t(1), message: { content: [{ type: 'thinking' }, { type: 'text', text: ' Looking now. ' }] } }),
      line({ type: 'assistant', timestamp: t(2), message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/p/src/auth.ts' } }] } }),
      line({ type: 'user', timestamp: t(3), message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', is_error: true }] } }),
      line({ type: 'assistant', timestamp: t(4), message: { content: [{ type: 'text', text: 'Fixed.' }] } }),
    ]
    const chat = chatFromLines(SID, lines, '/p')
    expect(chat.map((c) => c.kind)).toEqual(['you', 'claude', 'step', 'claude'])
    expect(chat[0]).toMatchObject({ text: 'fix the login', key: `p-${SID}-${Date.parse(t(0))}` })
    expect(chat[1]).toMatchObject({ text: 'Looking now.', key: `s-${SID}-${Date.parse(t(1))}-12` })
    expect(chat[2]).toMatchObject({ key: 'tu1', tool: 'Read', summary: 'src/auth.ts', isError: true })
  })

  it('skips helper threads, meta lines, slash commands and broken lines', () => {
    const lines = [
      '{not json',
      line({ type: 'user', isMeta: true, timestamp: t(0), message: { content: 'caveat' } }),
      line({ type: 'user', timestamp: t(1), message: { content: '<command-name>/clear</command-name>' } }),
      line({ type: 'assistant', isSidechain: true, timestamp: t(2), message: { content: [{ type: 'text', text: 'helper says' }] } }),
      line({ type: 'assistant', timestamp: t(3), message: { model: '<synthetic>', content: [{ type: 'text', text: 'No response' }] } }),
      line({ type: 'summary', summary: 'x' }),
    ]
    expect(chatFromLines(SID, lines, null)).toEqual([])
  })
})
