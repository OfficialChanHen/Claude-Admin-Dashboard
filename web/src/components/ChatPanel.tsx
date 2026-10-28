import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type ChatLine, type Project } from '../lib/api'
import { chatBlocks, mergeChat } from '../lib/chat'
import { CHAT_WIDTH_DEFAULT, clampChatWidth } from '../lib/chatWidth'
import { clock } from '../lib/format'
import { toolIcon } from '../lib/pixelIcons'
import type { WorldModel } from '../world/model'
import { taskLabel } from '../world/tasks'
import { SENIORS, YOU, lookOf } from '../world/render'
import { Markdown } from './Markdown'
import { PixelIcon } from './PixelIcon'
import { Portrait } from './Portrait'
import type { FeedItem } from './LiveFeed'

/** What the person is doing right now, read from the office every moment. */
function useStatus(model: WorldModel, sessionId: string) {
  const [status, setStatus] = useState<{ text: string; tone: '' | 'think' | 'turn' | 'work' }>({ text: '', tone: '' })
  useEffect(() => {
    const read = () => {
      const s = model.sprites.get(sessionId)
      let next: typeof status
      if (!s) next = { text: 'Not in the office right now', tone: '' }
      else if (s.state === 'waiting') next = { text: 'Needs your OK', tone: 'turn' }
      else if (s.running && s.tool) next = { text: taskLabel(s.tool, s.summary, 48), tone: 'work' }
      else if (model.thinking(s)) next = { text: 'Thinking', tone: 'think' }
      else if (s.state === 'working') next = { text: 'On the way to the desk', tone: 'work' }
      else next = { text: 'Waiting for your next prompt', tone: '' }
      setStatus((was) => (was.text === next.text && was.tone === next.tone ? was : next))
    }
    read()
    const t = setInterval(read, 400)
    return () => clearInterval(t)
  }, [model, sessionId])
  return status
}

/** Who they look like in the office, kept after they have left it. */
function useLook(model: WorldModel, sessionId: string) {
  const [look, setLook] = useState<number | null>(null)
  useEffect(() => {
    setLook(null)
    const read = () => {
      const s = model.sprites.get(sessionId)
      if (s) setLook(lookOf(s))
    }
    read()
    const t = setInterval(read, 1000)
    return () => clearInterval(t)
  }, [model, sessionId])
  return look ?? SENIORS[0]
}

const WIDTH_KEY = 'hq.chatWidth'

function storedWidth(): number {
  try {
    const v = Number(localStorage.getItem(WIDTH_KEY))
    return v > 0 ? v : CHAT_WIDTH_DEFAULT
  } catch {
    return CHAT_WIDTH_DEFAULT
  }
}

function storeWidth(px: number) {
  try {
    localStorage.setItem(WIDTH_KEY, String(px))
  } catch {
    // storage can be blocked; the width still applies for this visit
  }
}

/**
 * The conversation with one session: what you asked, what it answered, and
 * the steps in between. Opens when you click a person in the office. Anything
 * they are asking your OK for is answered from the "?" over their head.
 */
export function ChatPanel({
  sessionId,
  title,
  project,
  feed,
  model,
  onDetails,
  onSendHome,
  onClose,
}: {
  sessionId: string
  title: string
  project: Project | null
  feed: FeedItem[]
  model: WorldModel
  onDetails: () => void
  onSendHome: () => void
  onClose: () => void
}) {
  const [history, setHistory] = useState<ChatLine[] | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const scroller = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)
  const pinned = useRef(true)
  const status = useStatus(model, sessionId)
  const look = useLook(model, sessionId)

  // The dock (this panel plus the prompt box under it) reads its width from here,
  // so dragging the handle and shrinking the window both go through one clamp.
  useEffect(() => {
    const dock = panel.current?.closest<HTMLElement>('.chat-dock')
    if (!dock) return
    const apply = (px: number) => dock.style.setProperty('--chat-w', `${clampChatWidth(px, window.innerWidth)}px`)
    apply(storedWidth())
    const onResize = () => apply(parseFloat(dock.style.getPropertyValue('--chat-w')) || CHAT_WIDTH_DEFAULT)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const dock = panel.current?.closest<HTMLElement>('.chat-dock')
    if (!dock) return
    const startX = e.clientX
    const startWidth = dock.getBoundingClientRect().width
    const move = (ev: PointerEvent) => {
      dock.style.setProperty('--chat-w', `${clampChatWidth(startWidth + (ev.clientX - startX), window.innerWidth)}px`)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      storeWidth(parseFloat(dock.style.getPropertyValue('--chat-w')) || CHAT_WIDTH_DEFAULT)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  useEffect(() => {
    setHistory(null)
    setError('')
    api.chat(sessionId).then(setHistory).catch((e) => setError((e as Error).message))
  }, [sessionId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      // A window or question on top of the conversation closes first.
      if (e.key !== 'Escape' || t?.closest('input, textarea, select') || document.querySelector('.send-home, .game-window, .scrim')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const blocks = useMemo(() => chatBlocks(mergeChat(history ?? [], feed, sessionId)), [history, feed, sessionId])

  // Stay at the newest line, unless you have scrolled up to read.
  useEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [blocks, status])

  return (
    <aside className="chat-panel" role="dialog" aria-labelledby="chat-title" ref={panel}>
      <div className="chat-resize" role="separator" aria-orientation="vertical" aria-label="Resize the conversation" onPointerDown={startResize} />
      <div className="game-window-head">
        <div className="chat-who">
          <h2 className="panel-title" id="chat-title">{title}</h2>
          {project && <span className="proj-meta">{project.name}</span>}
        </div>
        <button className="btn small" onClick={onDetails}>Usage</button>
        <button className="btn small danger" onClick={onSendHome} title="Ends this session. You can carry on later with Continue last.">
          <PixelIcon name="door" size={12} />Send home
        </button>
        <button className="icon-btn" aria-label="Close" onClick={onClose}><PixelIcon name="close" size={12} /></button>
      </div>
      <div
        className="chat-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {error && <div className="chip err" role="alert">{error}</div>}
        {!history && !error && <div className="empty">Reading the conversation...</div>}
        {history && blocks.length === 0 && <div className="empty">Nothing said yet in this session.</div>}
        <ol className="chat" aria-live="polite">
          {blocks.map((b) => {
            if (b.kind === 'steps') {
              const expanded = open.has(b.key)
              const shown = expanded ? b.steps : b.steps.slice(-3)
              const failed = b.steps.filter((s) => s.isError).length
              return (
                <li key={b.key} className="chat-steps">
                  {b.steps.length > 3 && (
                    <button
                      className="chat-more"
                      aria-expanded={expanded}
                      onClick={() => setOpen((o) => {
                        const n = new Set(o)
                        if (expanded) n.delete(b.key)
                        else n.add(b.key)
                        return n
                      })}
                    >
                      {expanded ? 'Show fewer steps' : `${b.steps.length} steps${failed ? `, ${failed} failed` : ''}. Show all`}
                    </button>
                  )}
                  {shown.map((s) => (
                    <div key={s.key} className={`chat-step ${s.isError ? 'bad' : ''}`} title={`${s.tool} ${s.summary}`}>
                      <PixelIcon name={toolIcon(s.tool)} size={12} />
                      <span>{taskLabel(s.tool, s.summary, 60)}</span>
                      {s.running && <span className="chip state-working pulse">Running</span>}
                      {s.isError && <span className="chip err">Failed</span>}
                    </div>
                  ))}
                </li>
              )
            }
            return (
              <li key={b.key} className={`chat-msg ${b.kind}`}>
                <Portrait row={b.kind === 'you' ? YOU : look} label={b.kind === 'you' ? 'You' : title} />
                <div className="chat-body">
                  <div className="chat-meta">{b.kind === 'you' ? 'You' : 'Claude'} <span>{clock(b.ts)}</span></div>
                  {b.kind === 'you' ? (
                    <div className="chat-text">{b.text}</div>
                  ) : (
                    <div className="chat-text md"><Markdown text={b.text} /></div>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
        <div className={`chat-status ${status.tone}`} role="status">
          {status.tone === 'think' && <span className="think-dots" aria-hidden><i /><i /><i /></span>}
          {status.text}
        </div>
      </div>
    </aside>
  )
}
