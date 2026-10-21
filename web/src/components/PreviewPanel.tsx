import type { GitInfo, Preview, Project, Shot } from '../lib/api'
import { ago } from '../lib/format'

/** The TV in a room: its dev server and live site, plus what is changed and not pushed in git. */
export function PreviewPanel({ project, preview, git }: { project: Project; preview: Preview | undefined; git: GitInfo | undefined }) {
  return (
    <div className="panel-body preview-panel">
      <Screen
        title="Dev server"
        projectId={project.id}
        which="dev"
        shot={preview?.dev ?? null}
        detail={preview?.dev ? `Running on port ${preview.dev.port}` : null}
        empty="No dev server is running. Start one in this project and its page shows here within a minute."
      />
      <Screen
        title="Live site"
        projectId={project.id}
        which="prod"
        shot={preview?.prod ?? null}
        detail={preview?.prod?.url.replace(/^https?:\/\//, '').replace(/\/$/, '') ?? null}
        empty="No live site set. Add its address on the room's name plate."
      />
      {git && (
        <section className="preview-git">
          <h3 className="panel-title">Git</h3>
          <p>
            {git.branch ?? 'Detached'}
            {git.files ? `, ${git.files} file${git.files > 1 ? 's' : ''} changed (+${git.added} -${git.removed})` : ', nothing uncommitted'}
            {git.ahead ? `, ${git.ahead} commit${git.ahead > 1 ? 's' : ''} not pushed` : ''}
          </p>
          {git.subject && (
            <p className="note">
              Last commit: {git.subject}
              {git.lastCommitAt ? `, ${ago(git.lastCommitAt)}` : ''}
            </p>
          )}
        </section>
      )}
      <p className="note">Pictures are taken on this computer: the dev server every 2 minutes, the live site every 30. They cost no tokens.</p>
    </div>
  )
}

function Screen({ title, projectId, which, shot, detail, empty }: {
  title: string; projectId: string; which: 'dev' | 'prod'; shot: Shot | null; detail: string | null; empty: string
}) {
  return (
    <section className="preview-screen">
      <div className="preview-head">
        <h3 className="panel-title">{title}</h3>
        {shot && <a className="btn small" href={shot.url} target="_blank" rel="noreferrer">Open</a>}
      </div>
      {shot ? (
        <>
          {shot.shotAt ? (
            <img src={`/api/previews/${encodeURIComponent(projectId)}/${which}?t=${shot.shotAt}`} alt={`${title} as it looked ${ago(shot.shotAt)}`} />
          ) : (
            <p className="note">Taking a picture.</p>
          )}
          <p className="note">
            {detail}
            {shot.shotAt ? `. Picture taken ${ago(shot.shotAt)}.` : ''}
          </p>
        </>
      ) : (
        <p className="note">{empty}</p>
      )}
    </section>
  )
}
