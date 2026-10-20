import { describe, expect, it } from 'vitest'
import type { ChatLine } from './api'
import type { FeedItem } from '../components/LiveFeed'
import { chatBlocks, mergeChat } from './chat'

const S = 's1'
const history: ChatLine[] = [
  { kind: 'you', key: `p-${S}-1`, ts: 1, text: 'fix the login' },
  { kind: 'claude', key: `s-${S}-2-11`, ts: 2, text: 'Looking now' },
  { kind: 'step', key: 'tu1', ts: 3, tool: 'Read', summary: 'auth.ts', isError: false },
]

describe('mergeChat', () => {
  it('adds what arrived live, without repeating what the log already had', () => {
    const feed: FeedItem[] = [
      { type: 'action', key: 'tu2', ts: 4, sessionId: S, projectId: null, agentId: null, tool: 'Edit', summary: 'auth.ts', requestId: null, done: false, isError: false, resultTokens: 0 },
      { type: 'say', key: `s-${S}-2-11`, ts: 2, sessionId: S, projectId: null, agentId: null, text: 'Looking now' },
      { type: 'say', key: 'other', ts: 5, sessionId: 'elsewhere', projectId: null, agentId: null, text: 'not this one' },
      { type: 'say', key: 'helper', ts: 5, sessionId: S, projectId: null, agentId: 'h1', text: 'a helper talking' },
    ]
    const chat = mergeChat(history, feed, S)
    expect(chat.map((c) => c.key)).toEqual([`p-${S}-1`, `s-${S}-2-11`, 'tu1', 'tu2'])
    expect(chat[3]).toMatchObject({ kind: 'step', running: true })
  })

  it('drops the context editors wrap around a prompt', () => {
    const chat = mergeChat([{ kind: 'you', key: 'p', ts: 1, text: '<ide_selection>x</ide_selection>' }], [], S)
    expect(chat).toEqual([])
  })
})

describe('chatBlocks', () => {
  it('groups runs of steps between messages', () => {
    const blocks = chatBlocks([
      ...mergeChat(history, [], S),
      { kind: 'step', key: 'tu2', ts: 4, tool: 'Edit', summary: 'auth.ts', isError: false },
      { kind: 'claude', key: 'done', ts: 5, text: 'Fixed' },
    ])
    expect(blocks.map((b) => b.kind)).toEqual(['you', 'claude', 'steps', 'claude'])
    expect(blocks[2].kind === 'steps' && blocks[2].steps.map((s) => s.key)).toEqual(['tu1', 'tu2'])
  })
})
