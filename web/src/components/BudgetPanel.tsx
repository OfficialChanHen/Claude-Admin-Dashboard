import { useEffect, useState } from 'react'
import { api, type Budget, type Project } from '../lib/api'
import { ago } from '../lib/format'
import { useNow } from '../lib/useLive'

const PHASE: Record<Budget['phase'], string> = {
  ok: '',
  wrap: 'Sessions are wrapping up.',
  stop: 'New steps are on hold until the reset.',
}

/** The 5 hour budget under the plan meter: the rules, paused sessions and the spare usage queue. */
export function BudgetPanel({ projects, refreshKey }: { projects: Map<string, Project>; refreshKey: number }) {
  const now = useNow(30_000)
  const [budget, setBudget] = useState<Budget | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.budget().then(setBudget).catch(() => {})
  }, [refreshKey])

  if (!budget) return null
  if (!budget.on) return <p className="note">The 5 hour budget is off (HQ_BUDGET=off).</p>

  const name = (id: string | null) => (id && projects.get(id)?.name) || 'Other folder'
  const remove = (p: Promise<unknown>) => {
    setError('')
    p.then(() => api.budget().then(setBudget)).catch((e) => setError((e as Error).message))
  }

  return (
    <div className="budget">
      <p className="note">
        At {budget.wrapAt}% of the 5 hour limit, sessions finish the step they are on and stop. At {budget.stopAt}% new steps are held.
        In the last {budget.spareMin} minutes before a reset, if nothing else is running, HQ finishes paused work and then starts queued tasks.
        A prompt you type past the limit still runs.
      </p>
      {(PHASE[budget.phase] || budget.spare) && (
        <p className={`chip ${budget.phase === 'ok' ? '' : 'warn'}`} role="status">
          {budget.spare && budget.phase === 'ok' ? 'Spare usage: queued work can run now.' : PHASE[budget.phase]}
        </p>
      )}
      {error && <p className="chip err" role="alert">{error}</p>}

      <h3 className="budget-head">Paused</h3>
      {budget.paused.length ? (
        <ul className="budget-list">
          {budget.paused.map((p) => (
            <li key={p.sessionId}>
              <span className="budget-text">
                <b>{name(p.projectId)}</b> {p.title ?? 'Untitled session'}
                <span className="note"> paused {ago(p.pausedAt, now)}</span>
              </span>
              <button className="btn small" onClick={() => remove(api.dropPaused(p.sessionId))}>Leave it</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="note">Nothing paused.</p>
      )}

      <h3 className="budget-head">Queued for spare usage</h3>
      {budget.queue.length ? (
        <ul className="budget-list">
          {budget.queue.map((q) => (
            <li key={q.id}>
              <span className="budget-text">
                <b>{name(q.projectId)}</b> {q.text.length > 120 ? `${q.text.slice(0, 120)}...` : q.text}
              </span>
              <button className="btn small" onClick={() => remove(api.unqueue(q.id))}>Remove</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="note">Nothing queued. Pick Spare usage in a project's prompt box to add a task.</p>
      )}
    </div>
  )
}
