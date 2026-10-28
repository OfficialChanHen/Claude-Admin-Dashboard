import { useEffect, useRef, useState } from 'react'
import type { Project } from '../lib/api'
import { PixelIcon } from './PixelIcon'
import { zoneColor } from './ProjectsPanel'

export type SendOptions = { mode: 'new' | 'continue'; permissionMode: 'acceptEdits' | 'plan'; when: 'now' | 'spare'; model?: Model }

// Default leaves the model to your usual Claude Code setting.
const MODELS = [['default', 'Default'], ['fable', 'Fable'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']] as const
type Model = Exclude<(typeof MODELS)[number][0], 'default'>

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

/** The person you clicked on. A prompt to them carries on their conversation. */
export type PromptTarget = { sessionId: string; name: string; busy: boolean }

/**
 * One prompt box for the person you clicked on, or else the project area you
 * last clicked. In Other folders (`chat`) it starts a chat about no project.
 */
export function PromptBar({
  project,
  target,
  chat = false,
  focusKey,
  onSend,
  onClear,
}: {
  project: Project | null
  target: PromptTarget | null
  chat?: boolean
  focusKey: number
  onSend: (text: string, opts: SendOptions) => Promise<void>
  onClear: () => void
}) {
  const [text, setText] = useState('')
  const [mode, setMode] = useState<SendOptions['mode']>(() => stored('hq.prompt.mode', ['new', 'continue'] as const, 'new'))
  const [perm, setPerm] = useState<SendOptions['permissionMode']>(() => stored('hq.prompt.perm', ['acceptEdits', 'plan'] as const, 'acceptEdits'))
  const [model, setModel] = useState<(typeof MODELS)[number][0]>(() => stored('hq.prompt.model', MODELS.map(([k]) => k), 'default'))
  // Spare usage waits for the last half hour before a reset, as a new task.
  const [when, setWhen] = useState<SendOptions['when']>('now')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if ((project || target || chat) && focusKey) ref.current?.focus()
  }, [project, target?.sessionId, chat, focusKey])

  useEffect(() => {
    if (!note || note.bad) return
    const t = setTimeout(() => setNote(null), 6000)
    return () => clearTimeout(t)
  }, [note])

  if (!project && !target && !chat) {
    return <div className="prompt-bar hud-plate prompt-empty">Click a project’s area on the floor to prompt it.</div>
  }

  const name = target?.name ?? project?.name ?? 'A chat'
  // A prompt to one person goes now, into their own conversation. So does a chat.
  const sendWhen = target || chat ? 'now' : when

  const send = async () => {
    const t = text.trim()
    if (!t || busy || target?.busy) return
    setBusy(true)
    setNote(null)
    try {
      await onSend(t, { mode: target ? 'continue' : sendWhen === 'spare' ? 'new' : mode, permissionMode: perm, when: sendWhen, ...(model === 'default' ? {} : { model }) })
      setText('')
      setNote({
        text: target
          ? `Sent to ${name}. They will get back to their desk shortly.`
          : chat
            ? 'Sent. Someone will sit down in Other folders shortly; click them to read the reply.'
          : sendWhen === 'spare'
            ? `Queued for ${name}. It starts near the next reset if usage is left and nothing else is running.`
            : `Sent to ${name}. Someone will sit down at a desk there shortly.`,
        bad: false,
      })
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
        {project && <span className="zone" style={{ background: zoneColor(project.color) }} />}
        <span className="prompt-name">
          {name}
          {target && project && <span className="prompt-sub">{project.name}</span>}
          {chat && <span className="prompt-sub">about no project</span>}
        </span>
        {!target && !chat && (
          <div className="seg" role="group" aria-label="When">
            {([['now', 'Now'], ['spare', 'Spare usage']] as const).map(([k, l]) => (
              <button type="button" key={k} aria-pressed={when === k} onClick={() => setWhen(k)}>
                {l}
              </button>
            ))}
          </div>
        )}
        {!target && when === 'now' && (
          <div className="seg" role="group" aria-label="Session">
            {([['new', chat ? 'New chat' : 'New task'], ['continue', 'Continue last']] as const).map(([k, l]) => (
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
        )}
        {/* A chat has no project to edit: anything beyond reading asks you in HQ. */}
        {!chat && <div className="seg" role="group" aria-label="What it may do">
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
        </div>}
        <div className="seg" role="group" aria-label="Model">
          {MODELS.map(([k, l]) => (
            <button
              type="button"
              key={k}
              aria-pressed={model === k}
              onClick={() => {
                setModel(k)
                store('hq.prompt.model', k)
              }}
            >
              {l}
            </button>
          ))}
        </div>
        <button type="button" className="icon-btn" aria-label={target ? `Stop talking to ${name}` : chat ? 'Stop chatting' : 'Stop prompting this project'} onClick={onClear}><PixelIcon name="close" size={12} /></button>
      </div>
      <div className="prompt-row">
        <textarea
          ref={ref}
          className="input prompt-input"
          rows={1}
          value={text}
          placeholder={target?.busy ? `${name} is still working. You can send this once they finish.` : target ? `What should ${name} do next?` : chat ? 'Ask anything. It is not about any project.' : `What should ${name} do?`}
          aria-label={`Prompt for ${name}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        <button className="btn primary" type="submit" disabled={busy || !text.trim() || !!target?.busy}>{busy ? 'Sending...' : sendWhen === 'spare' ? 'Queue' : 'Send'}</button>
      </div>
      {note && <div className={`prompt-note ${note.bad ? 'bad' : ''}`} role={note.bad ? 'alert' : 'status'}>{note.text}</div>}
    </form>
  )
}
