import { describe, expect, it, vi } from 'vitest'

// The log reader shares helpers with the transcript module, which opens the database; tests use a stand-in.
vi.mock('./db.js', () => ({ get: vi.fn(), run: vi.fn(), all: vi.fn(() => []), tx: vi.fn((f: () => void) => f()) }))

const { chatFromLines, withJoined } = await import('./chat.js')

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

describe('withJoined', () => {
  const you = (s: number, text: string) => ({ kind: 'you' as const, key: `p-${SID}-${Date.parse(t(s))}`, ts: Date.parse(t(s)), text })
  const step = (s: number) => ({ kind: 'step' as const, key: `tu${s}`, ts: Date.parse(t(s)), tool: 'Read', summary: 'a.ts', isError: false })

  it('shows a prompt sent mid-task at the time you sent it, not when Claude read it', () => {
    const chat = withJoined(SID, [you(0, 'fix it'), step(1), step(3), you(4, 'also the tests')], [{ ts: Date.parse(t(2)), text: 'also the tests' }])
    expect(chat.map((c) => c.key)).toEqual([`p-${SID}-${Date.parse(t(0))}`, 'tu1', `p-${SID}-${Date.parse(t(2))}`, 'tu3'])
  })

  it('shows a prompt Claude has not read yet', () => {
    const chat = withJoined(SID, [you(0, 'fix it'), step(1)], [{ ts: Date.parse(t(2)), text: 'and this' }])
    expect(chat.at(-1)).toMatchObject({ kind: 'you', text: 'and this', key: `p-${SID}-${Date.parse(t(2))}` })
  })

  it('keeps the same words asked again later', () => {
    const chat = withJoined(SID, [you(0, 'go on'), you(4, 'go on')], [{ ts: Date.parse(t(2)), text: 'go on' }])
    expect(chat.map((c) => c.ts)).toEqual([0, 2].map((s) => Date.parse(t(s))))
    expect(withJoined(SID, [you(0, 'go on'), you(3, 'go on'), you(5, 'go on')], [{ ts: Date.parse(t(2)), text: 'go on' }]).map((c) => c.ts))
      .toEqual([0, 2, 5].map((s) => Date.parse(t(s))))
  })
})
