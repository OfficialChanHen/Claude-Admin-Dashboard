import { useEffect, useRef, useState } from 'react'
import type { Project } from '../lib/api'
import { rememberModel, startingModel } from '../lib/promptModel'
import { PixelIcon } from './PixelIcon'
import { zoneColor } from './ProjectsPanel'

export type SendOptions = { mode: 'new' | 'continue'; permissionMode: 'auto' | 'plan'; when: 'now' | 'spare'; model?: Model }

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
  const [perm, setPerm] = useState<SendOptions['permissionMode']>(() => stored('hq.prompt.perm', ['auto', 'plan'] as const, 'auto'))
  const remembered = () => stored('hq.prompt.model', MODELS.map(([k]) => k), 'default')
  const [model, setModel] = useState<(typeof MODELS)[number][0]>(() => startingModel(!!target, remembered()))
  // Spare usage waits for the last half hour before a reset, as a new task.
  const [when, setWhen] = useState<SendOptions['when']>('now')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if ((project || target || chat) && focusKey) ref.current?.focus()
  }, [project, target?.sessionId, chat, focusKey])

  // Switching between a person and a project picks the starting model again.
  useEffect(() => {
    setModel(startingModel(!!target, remembered()))
  }, [target?.sessionId])

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
      if (target) setModel('default')
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

  const ctxLabel = target ? `Stop talking to ${name}` : chat ? 'Stop chatting' : 'Stop prompting this project'
  const sendLabel = busy ? 'Sending' : sendWhen === 'spare' ? 'Queue' : 'Send'

  // Laid out like the Claude Code extension's input: the text on top, and a footer
  // inside the same box with the options on the left and who it goes to beside Send.
  return (
    <form
      className="prompt-bar prompt-box"
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
    >
      <textarea
        ref={ref}
        className="prompt-input"
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
      <div className="prompt-foot">
        {!target && !chat && (
          <Picker label="When" value={when} onPick={setWhen} options={[
            ['now', 'Now', 'Starts straight away'],
            ['spare', 'Spare usage', 'Waits for the last half hour before a reset, if usage is left'],
          ]} />
        )}
        {!target && when === 'now' && (
          <Picker label="Session" value={mode} onPick={(k) => { setMode(k); store('hq.prompt.mode', k) }} options={[
            ['new', chat ? 'New chat' : 'New task', 'Someone new sits down for it'],
            ['continue', 'Continue last', 'Carries on the last conversation here'],
          ]} />
        )}
        {/* Auto runs routine steps without asking; only risky ones and questions come to you. */}
        {!chat && (
          <Picker label="Mode" value={perm} onPick={(k) => { setPerm(k); store('hq.prompt.perm', k) }} options={[
            ['auto', 'Auto mode', 'Runs routine steps without asking. Risky ones and questions come to you'],
            ['plan', 'Plan mode', 'Makes a plan and changes nothing until you say go'],
          ]} />
        )}
        <Picker label="Model" value={model} onPick={(k) => { setModel(k); if (rememberModel(!!target)) store('hq.prompt.model', k) }} options={MODELS.map(([k, l]) => [k, l, k === 'default' ? 'Your usual Claude Code model' : ''] as const)} />
        <span className="prompt-ctx" title={target && project ? `${name} in ${project.name}` : name}>
          {project && <span className="zone" style={{ background: zoneColor(project.color) }} />}
          <span className="prompt-name">{name}</span>
          {target && project && <span className="prompt-sub">{project.name}</span>}
          {chat && <span className="prompt-sub">no project</span>}
          <button type="button" className="prompt-ctx-x" aria-label={ctxLabel} title={ctxLabel} onClick={onClear}><PixelIcon name="close" size={8} /></button>
        </span>
        <button className="prompt-send" type="submit" disabled={busy || !text.trim() || !!target?.busy} aria-label={sendLabel} title={`${sendLabel} (Enter)`}>
          <PixelIcon name={busy ? 'dots' : 'up'} size={14} />
        </button>
      </div>
      {note && <div className={`prompt-note ${note.bad ? 'bad' : ''}`} role={note.bad ? 'alert' : 'status'}>{note.text}</div>}
    </form>
  )
}

/** A footer option that opens a small menu above it, as the extension's mode and model pickers do. */
function Picker<T extends string>({
  label,
  value,
  options,
  onPick,
}: {
  label: string
  value: T
  options: readonly (readonly [T, string, string])[]
  onPick: (v: T) => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', away)
    return () => window.removeEventListener('pointerdown', away)
  }, [open])

  const current = options.find(([k]) => k === value)
  return (
    <span
      className="picker"
      ref={box}
      onKeyDown={(e) => {
        // Escape shuts the menu, not the conversation behind it.
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          setOpen(false)
        }
      }}
    >
      <button type="button" className="picker-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`${label}: ${current?.[1]}`} onClick={() => setOpen((o) => !o)}>
        {current?.[1]}
        <PixelIcon name="chevron" size={8} />
      </button>
      {open && (
        <div className="picker-menu" role="menu" aria-label={label}>
          <div className="picker-title">{label}</div>
          {options.map(([k, l, d]) => (
            <button
              type="button"
              key={k}
              role="menuitemradio"
              aria-checked={k === value}
              autoFocus={k === value}
              onClick={() => {
                onPick(k)
                setOpen(false)
              }}
            >
              <span className="picker-label">{l}{d && <span className="picker-desc">{d}</span>}</span>
              {k === value && <PixelIcon name="check" size={10} />}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
