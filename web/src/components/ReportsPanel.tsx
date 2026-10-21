import { useEffect, useState } from 'react'
import { api, type Hierarchy, type Project, type Report } from '../lib/api'
import { clock } from '../lib/format'
import { Markdown } from './Markdown'

/**
 * What the boss and each project's manager reported. Reports go up the ranks:
 * helpers to their agent, agents to their project's manager, managers to the boss.
 */
export function ReportsPanel({ projects, refreshKey, onOpen }: { projects: Map<string, Project>; refreshKey: number; onOpen: (sessionId: string) => void }) {
  const [h, setH] = useState<Hierarchy | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api.hierarchy().then(setH, (e: Error) => setError(e.message))
  }, [refreshKey])

  if (error) return <p className="note bad">{error}</p>
  if (!h) return <p className="note">Loading…</p>

  const name = (r: Pick<Report, 'role' | 'projectId'>) =>
    r.role === 'boss' ? 'The boss' : `Manager of ${projects.get(r.projectId ?? '')?.name ?? 'a project'}`
  // The newest report from each, the boss first.
  const latest = new Map<string, Report>()
  for (const r of h.reports) if (!latest.has(r.sessionId)) latest.set(r.sessionId, r)
  const top = [...latest.values()].sort((a, b) => (a.role === b.role ? b.ts - a.ts : a.role === 'boss' ? -1 : 1))
  const older = h.reports.filter((r) => latest.get(r.sessionId) !== r)

  return (
    <div className="reports">
      <p className="note">
        A project gets a manager once two or more agents work in it at once, and the boss comes in once two or more projects
        have agents at work. Each sums up its agents at most every {h.everyMin} minutes, only when something new happened, and can
        prompt the agents below it. Each round is a prompt on your plan.
        {!h.on && ' They are turned off (HQ_HIERARCHY=off).'}
      </p>
      {h.roles.filter((r) => r.running).map((r) => (
        <p key={r.sessionId} className="note">{name(r)} is putting a report together…</p>
      ))}
      {top.length ? (
        <ul className="report-list">
          {top.map((r) => (
            <li key={r.id} className={`report ${r.role}`}>
              <div className="report-head">
                <button className="link" onClick={() => onOpen(r.sessionId)}>{name(r)}</button>
                <span className="report-time">{clock(r.ts)}</span>
              </div>
              <div className="chat-text md"><Markdown text={r.text} /></div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="note">No reports yet.</p>
      )}
      {older.length > 0 && (
        <details className="report-older">
          <summary>Earlier reports ({older.length})</summary>
          <ul className="report-list">
            {older.map((r) => (
              <li key={r.id} className={`report ${r.role}`}>
                <div className="report-head">
                  <span>{name(r)}</span>
                  <span className="report-time">{clock(r.ts)}</span>
                </div>
                <div className="chat-text md"><Markdown text={r.text} /></div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
