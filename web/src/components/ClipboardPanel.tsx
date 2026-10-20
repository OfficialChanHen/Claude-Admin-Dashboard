import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, type Clipboard, type Helper, type Step } from '../lib/api'
import { ago } from '../lib/format'
import { useNow } from '../lib/useLive'
import { PixelIcon } from './PixelIcon'

// A project's clipboard. Your list is yours to add to and tick off. Claude's
// plans are the to-do lists its sessions keep, read from the session logs, with
// what each helper is doing under the task it was sent for.

const HELPER: Record<Helper['status'], string> = { working: 'working', done: 'reported back', failed: 'hit an error', stopped: 'stopped' }

function Mark({ status }: { status: Step['status'] }) {
  if (status === 'completed') return <span className="clip-mark done" aria-label="Done"><PixelIcon name="check" size={10} /></span>
  if (status === 'in_progress') return <span className="clip-mark doing" aria-label="In progress"><PixelIcon name="arrow" size={10} /></span>
  return <span className="clip-mark" aria-label="To do" />
}

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ul className="clip-steps">
      {steps.map((s, i) => (
        <li key={i} className={s.status === 'completed' ? 'is-done' : ''}>
          <Mark status={s.status} />
          <span>{s.status === 'in_progress' && s.active ? s.active : s.text}</span>
        </li>
      ))}
    </ul>
  )
}

function Helpers({ helpers }: { helpers: Helper[] }) {
  return (
    <ul className="clip-helpers">
      {helpers.map((h) => (
        <li key={h.id}>
          <div className={`clip-helper ${h.status}`}>
            <PixelIcon name="person" size={10} />
            <span>
              {h.description}
              <span className="note"> {h.agentType ? `${h.agentType}, ` : ''}{HELPER[h.status]}</span>
            </span>
          </div>
          {h.steps.length > 0 && <Steps steps={h.steps} />}
        </li>
      ))}
    </ul>
  )
}

export function ClipboardPanel({ projectId, canSend, refreshKey, onOpenSession }: {
  projectId: string
  /** Whether items can be sent to Claude: only for your projects, not Other folders. */
  canSend: boolean
  refreshKey: number
  onOpenSession: (id: string) => void
}) {
  const now = useNow(30_000)
  const [board, setBoard] = useState<Clipboard | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState<string | null>(null)

  const load = useCallback(() => api.clipboard(projectId).then(setBoard).catch((e) => setError((e as Error).message)), [projectId])
  useEffect(() => {
    load()
  }, [load, refreshKey])

  const act = (p: Promise<unknown>) => {
    setError('')
    return p.then(load).catch((e) => setError((e as Error).message))
  }
  const add = (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    act(api.addNote(projectId, text).then(() => setText('')))
  }
  const send = (id: string, t: string) =>
    act(api.prompt({ projectId, text: t, mode: 'new', permissionMode: 'acceptEdits' }).then(() => setSent(id)))

  if (!board) return <div className="panel-body note">{error || 'Reading the clipboard...'}</div>

  return (
    <div className="panel-body clipboard">
      {error && <p className="chip err" role="alert">{error}</p>}

      <section aria-labelledby="clip-yours">
        <h3 className="clip-head" id="clip-yours">Your list</h3>
        <form className="clip-add" onSubmit={add}>
          <input
            className="input"
            value={text}
            maxLength={500}
            placeholder="Add something to do"
            aria-label="New item"
            onChange={(e) => setText(e.target.value)}
          />
          <button className="btn small primary" type="submit" disabled={!text.trim()}>Add</button>
        </form>
        {board.notes.length ? (
          <ul className="clip-notes">
            {board.notes.map((n) => (
              <li key={n.id} className={n.done ? 'is-done' : ''}>
                <label>
                  <input type="checkbox" checked={n.done} onChange={() => act(api.updateNote(n.id, { done: !n.done }))} />
                  <span>{n.text}</span>
                </label>
                <span className="row">
                  {canSend && !n.done && (
                    <button className="btn small" disabled={sent === n.id} onClick={() => send(n.id, n.text)}>
                      {sent === n.id ? 'Sent' : 'Send to Claude'}
                    </button>
                  )}
                  <button className="icon-btn" aria-label={`Remove ${n.text}`} onClick={() => act(api.removeNote(n.id))}>
                    <PixelIcon name="close" size={10} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="note">Nothing yet. Items you add stay here until you remove them.</p>
        )}
        {canSend && <p className="note">Send to Claude starts the item as a new task that can edit files.</p>}
      </section>

      <section aria-labelledby="clip-claude">
        <h3 className="clip-head" id="clip-claude">Claude's plans</h3>
        {board.plans.length ? (
          board.plans.map((p) => (
            <article key={p.sessionId} className="clip-plan">
              <div className="clip-plan-head">
                <button className="link" onClick={() => onOpenSession(p.sessionId)}>{p.title ?? 'Untitled session'}</button>
                <span className="note">
                  {p.tasks.filter((t) => t.status === 'completed').length} of {p.tasks.length} done, updated {ago(p.updatedAt, now)}
                </span>
              </div>
              <ul className="clip-tasks">
                {p.tasks.map((t, i) => (
                  <li key={i}>
                    <div className={`clip-task ${t.status === 'completed' ? 'is-done' : ''}`}>
                      <Mark status={t.status} />
                      <span>{t.status === 'in_progress' && t.active ? t.active : t.text}</span>
                    </div>
                    {t.helpers.length > 0 && <Helpers helpers={t.helpers} />}
                  </li>
                ))}
              </ul>
              {p.helpers.length > 0 && (
                <>
                  <p className="note">Other helpers</p>
                  <Helpers helpers={p.helpers} />
                </>
              )}
            </article>
          ))
        ) : (
          <p className="note">No plans in the last few days. When a session makes a to-do list, it shows up here and ticks off as the work gets done.</p>
        )}
      </section>
    </div>
  )
}
