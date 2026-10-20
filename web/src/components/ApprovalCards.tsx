import { useEffect, useRef, useState } from 'react'
import { api, type Approval } from '../lib/api'
import { useNow } from '../lib/useLive'

const WIDTH = 320
const GAP = 10

// What a session is asking to do, in a card over their head. The person in the
// office has a "?" over their head while they wait; click it to open this.
// Each request waits a short while, then goes back to the terminal. Allow and
// Deny answer just this one request.

export function AskPopup({
  label,
  approvals,
  headOf,
  onOpenChat,
  onClose,
}: {
  label: string
  /** This session's requests waiting for your OK. */
  approvals: Approval[]
  /** Where their head is on the page right now, so the card follows them. */
  headOf: () => { x: number; y: number } | null
  onOpenChat: () => void
  onClose: () => void
}) {
  const now = useNow(1000)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const first = useRef<HTMLButtonElement>(null)

  // Follow them as they move and as you pan or zoom.
  useEffect(() => {
    let raf = 0
    const place = () => {
      raf = requestAnimationFrame(place)
      const el = ref.current
      if (!el) return
      // Off screen (or opened from the keyboard list): the middle of the page.
      const at = headOf() ?? { x: window.innerWidth / 2, y: window.innerHeight * 0.3 + el.offsetHeight + GAP }
      const left = Math.max(12, Math.min(window.innerWidth - WIDTH - 12, at.x - WIDTH / 2))
      const top = Math.max(12, at.y - GAP - el.offsetHeight)
      el.style.left = `${left}px`
      el.style.top = `${top}px`
      el.style.setProperty('--tail', `${Math.max(12, Math.min(WIDTH - 12, at.x - left))}px`)
      el.style.visibility = 'visible'
    }
    place()
    return () => cancelAnimationFrame(raf)
  }, [headOf])

  useEffect(() => {
    first.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Once everything they asked is answered, the card goes away.
  const had = useRef(approvals.length > 0)
  useEffect(() => {
    if (approvals.length) had.current = true
    else if (had.current) onClose()
  }, [approvals.length, onClose])

  const answer = async (id: string, d: 'allow' | 'deny' | 'terminal') => {
    setBusy(id)
    setError('')
    try {
      await api.answer(id, d)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div ref={ref} className="ask-popup approvals" style={{ width: WIDTH, visibility: 'hidden' }} role="dialog" aria-label={`${label} needs your OK`} aria-live="polite">
      <div className="approval-head">
        <span className="approvals-title">Needs your OK</span>
        <button className="link small" onClick={onOpenChat}>Conversation</button>
      </div>
      {error && <div className="chip err" role="alert">{error}</div>}
      {approvals.length === 0 ? (
        <>
          <p className="approval-note">They are asking in the terminal. Answer them there.</p>
          <div className="row">
            <button ref={first} className="btn small" onClick={onClose}>OK</button>
          </div>
        </>
      ) : (
        <ul>
          {approvals.map((a, i) => {
            const left = Math.max(0, Math.ceil((a.expiresAt - now) / 1000))
            const shown = open === a.id
            return (
              <li key={a.id} className="approval">
                <div className="approval-head">
                  <span className="approval-what"><b>{a.tool}</b> {a.summary}</span>
                  <span className="approval-left">{left}s</span>
                </div>
                {a.detail && a.detail !== a.summary && (
                  <>
                    <button className="link small" aria-expanded={shown} onClick={() => setOpen(shown ? null : a.id)}>
                      {shown ? 'Hide details' : 'Show details'}
                    </button>
                    {shown && <pre className="approval-detail">{a.detail}</pre>}
                  </>
                )}
                <div className="row">
                  <button ref={i === 0 ? first : undefined} className="btn small primary" disabled={busy === a.id} onClick={() => answer(a.id, 'allow')}>Allow</button>
                  <button className="btn small danger" disabled={busy === a.id} onClick={() => answer(a.id, 'deny')}>Deny</button>
                  {!a.headless && (
                    <button className="btn small" disabled={busy === a.id} onClick={() => answer(a.id, 'terminal')}>Ask in terminal</button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
