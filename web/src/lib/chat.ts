import type { ChatLine } from './api'
import type { FeedItem } from '../components/LiveFeed'
import { promptText } from '../world/model'

/** A chat line, with whether a step is still running. */
export type ChatItem = ChatLine & { running?: boolean }

/** A conversation, grouped for display: messages, and runs of steps between them. */
export type ChatBlock = { kind: 'you' | 'claude'; key: string; ts: number; text: string } | { kind: 'steps'; key: string; steps: Extract<ChatItem, { kind: 'step' }>[] }

/**
 * The session's history from its log, plus whatever has arrived live since.
 * Lines are matched on their keys, so nothing shows twice. Helpers' own lines
 * are left out: this is the conversation between you and the session.
 */
export function mergeChat(history: ChatLine[], feed: FeedItem[], sessionId: string): ChatItem[] {
  const byKey = new Map<string, ChatItem>()
  for (const h of history) byKey.set(h.key, h)
  for (const f of feed) {
    if (f.sessionId !== sessionId || ('agentId' in f && f.agentId)) continue
    if (f.type === 'prompt') byKey.set(f.key, byKey.get(f.key) ?? { kind: 'you', key: f.key, ts: f.ts, text: f.text })
    else if (f.type === 'say') byKey.set(f.key, byKey.get(f.key) ?? { kind: 'claude', key: f.key, ts: f.ts, text: f.text })
    else if (f.type === 'action') {
      const was = byKey.get(f.key)
      byKey.set(f.key, { kind: 'step', key: f.key, ts: f.ts, tool: f.tool, summary: f.summary, isError: f.isError || (was?.kind === 'step' && was.isError), running: !f.done })
    }
  }
  const out: ChatItem[] = []
  for (const item of byKey.values()) {
    if (item.kind === 'you') {
      const text = promptText(item.text)
      if (!text) continue
      out.push({ ...item, text })
    } else out.push(item)
  }
  // Same-time lines keep their order from the log: messages before the steps they lead into.
  const order = new Map([...byKey.keys()].map((k, i) => [k, i]))
  return out.sort((a, b) => a.ts - b.ts || order.get(a.key)! - order.get(b.key)!)
}

/** Groups runs of steps, so a long stretch of work reads as one block between messages. */
export function chatBlocks(items: ChatItem[]): ChatBlock[] {
  const out: ChatBlock[] = []
  for (const it of items) {
    if (it.kind !== 'step') {
      out.push({ kind: it.kind, key: it.key, ts: it.ts, text: it.text })
      continue
    }
    const last = out[out.length - 1]
    if (last?.kind === 'steps') last.steps.push(it)
    else out.push({ kind: 'steps', key: `g-${it.key}`, steps: [it] })
  }
  return out
}
