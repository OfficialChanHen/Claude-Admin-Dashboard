import { useEffect, useRef, useState } from 'react'
import type { Project } from '../lib/api'
import { PixelIcon } from './PixelIcon'
import { zoneColor } from './ProjectsPanel'

export type SendOptions = { mode: 'new' | 'continue'; permissionMode: 'acceptEdits' | 'plan' }

function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null
    return v && allowed.includes(v) ? v : fallback
  } catch {
    return fallback
  }
}

function store(key: string, v: string) {
  try {
    localStorage.setItem(key, v)
  } catch {
    // storage can be blocked; the choice still applies for this visit
  }
}

/** One prompt box for whichever project area you last clicked. */
export function PromptBar({
  project,
  focusKey,
  onSend,
  onClear,
}: {
  project: Project | null
  focusKey: number
  onSend: (text: string, opts: SendOptions) => Promise<void>
  onClear: () => void
}) {
  const [text, setText] = useState('')
  const [mode, setMode] = useState<SendOptions['mode']>(() => stored('hq.prompt.mode', ['new', 'continue'] as const, 'new'))
  const [perm, setPerm] = useState<SendOptions['permissionMode']>(() => stored('hq.prompt.perm', ['acceptEdits', 'plan'] as const, 'acceptEdits'))
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (project && focusKey) ref.current?.focus()
  }, [project, focusKey])

  useEffect(() => {
    if (!note || note.bad) return
    const t = setTimeout(() => setNote(null), 6000)
    return () => clearTimeout(t)
  }, [note])

  if (!project) {
    return <div className="prompt-bar hud-plate prompt-empty">Click a project’s area on the floor to prompt it.</div>
  }

  const send = async () => {
    const t = text.trim()
    if (!t || busy) return
    setBusy(true)
    setNote(null)
    try {
      await onSend(t, { mode, permissionMode: perm })
      setText('')
      setNote({ text: `Sent to ${project.name}. Someone will sit down at a desk there shortly.`, bad: false })
    } catch (e) {
      setNote({ text: (e as Error).message, bad: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="prompt-bar hud-plate"
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
    >
      <div className="prompt-to">
        <span className="zone" style={{ background: zoneColor(project.color) }} />
        <span className="prompt-name">{project.name}</span>
        <div className="seg" role="group" aria-label="Session">
          {([['new', 'New task'], ['continue', 'Continue last']] as const).map(([k, l]) => (
            <button
              type="button"
              key={k}
              aria-pressed={mode === k}
              onClick={() => {
                setMode(k)
                store('hq.prompt.mode', k)
              }}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="What it may do">
          {([['acceptEdits', 'Can edit'], ['plan', 'Plan only']] as const).map(([k, l]) => (
            <button
              type="button"
              key={k}
              aria-pressed={perm === k}
              onClick={() => {
                setPerm(k)
                store('hq.prompt.perm', k)
              }}
            >
              {l}
            </button>
          ))}
        </div>
        <button type="button" className="icon-btn" aria-label="Stop prompting this project" onClick={onClear}><PixelIcon name="close" size={12} /></button>
      </div>
      <div className="prompt-row">
        <textarea
          ref={ref}
          className="input prompt-input"
          rows={1}
          value={text}
          placeholder={`What should ${project.name} do?`}
          aria-label={`Prompt for ${project.name}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        <button className="btn primary" type="submit" disabled={busy || !text.trim()}>{busy ? 'Sending...' : 'Send'}</button>
      </div>
      {note && <div className={`prompt-note ${note.bad ? 'bad' : ''}`} role={note.bad ? 'alert' : 'status'}>{note.text}</div>}
    </form>
  )
}
