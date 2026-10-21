import { useEffect, useRef, useState } from 'react'
import type { ActiveSession, Approval, Project } from '../lib/api'
import { nameOf } from '../world/model'
import { roleTag } from '../world/render'

/** Who is asking: by role for the boss and managers, by title for everyone else. */
export function askerName(a: Approval, active: ActiveSession[], label?: string) {
  const s = active.find((x) => x.id === a.sessionId)
  return s ? nameOf(s) : label ?? 'A session'
}

/**
 * Every request waiting for your OK, under the "Needs your OK" plate. Picking
 * one opens its card. Sessions HQ started have no terminal to fall back on, so
 * those show how long is left before the step is refused.
 */
export function ApprovalsList({
  approvals, active, projects, labelOf, onPick, onClose,
}: {
  approvals: Approval[]
  active: ActiveSession[]
  projects: Map<string, Project>
  labelOf: (sessionId: string) => string | undefined
  onPick: (a: Approval, name: string) => void
  onClose: () => void
}) {
  const [now, setNow] = useState(Date.now())
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    ref.current?.querySelector('button')?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      clearInterval(t)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const list = [...approvals].sort((x, y) => x.expiresAt - y.expiresAt)
  return (
    <div className="approvals-list hud-plate" role="dialog" aria-label="Waiting for your OK" ref={ref}>
      {list.length ? (
        <ul>
          {list.map((a) => {
            const s = active.find((x) => x.id === a.sessionId)
            const name = askerName(a, active, labelOf(a.sessionId))
            const tag = roleTag({ rank: 'senior', role: s?.role ?? null })
            const project = a.projectId ? projects.get(a.projectId)?.name : null
            const left = Math.max(0, Math.ceil((a.expiresAt - now) / 1000))
            return (
              <li key={a.id}>
                <button className="approvals-item" onClick={() => onPick(a, name)}>
                  <span className="approvals-who">
                    <span className={`key-chip role-${tag.tone}`}>{tag.text}</span>
                    <span className="approvals-name">{name}</span>
                    {project && <span className="approvals-project">{project}</span>}
                  </span>
                  <span className="approvals-what">{a.summary}</span>
                  <span className={`approvals-left ${a.headless && left <= 15 ? 'soon' : ''}`}>
                    {a.headless ? `Refused in ${left}s if you don't answer` : `Goes to the terminal in ${left}s`}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="note">Nothing is waiting for your OK.</p>
      )}
    </div>
  )
}
