import { useState } from 'react'
import { api, type ActiveSession, type Project } from '../lib/api'

const ZONES = ['sage', 'clay', 'sky', 'wheat', 'plum', 'fern', 'rose', 'stone']

export function zoneColor(key: string | undefined) {
  return `var(--zone-${key ?? 'stone'})`
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <span className="switch">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </span>
  )
}

function ProjectEditor({ p, onDone }: { p: Project; onDone: () => void }) {
  const [aliases, setAliases] = useState(p.aliases.join(', '))
  const [prodUrl, setProdUrl] = useState(p.prodUrl ?? '')
  const [devPort, setDevPort] = useState(p.devPort ? String(p.devPort) : '')
  const [confirm, setConfirm] = useState(false)

  const save = async () => {
    await api.updateProject(p.id, {
      aliases: aliases.split(',').map((a) => a.trim()).filter(Boolean),
      prodUrl: prodUrl.trim() || null,
      devPort: devPort ? Number(devPort) : null,
    })
    onDone()
  }

  return (
    <div className="proj-edit">
      <div className="proj-meta" title={p.path}>{p.path.replace(/^\/home\/[^/]+/, '~')}</div>
      <label className="field">
        Other names you call it
        <input className="input" value={aliases} placeholder="the scheduling app, when2meet" onChange={(e) => setAliases(e.target.value)} />
      </label>
      <label className="field">
        Live site
        <input className="input" value={prodUrl} placeholder="https://example.com" onChange={(e) => setProdUrl(e.target.value)} />
      </label>
      {p.devCmd && (
        <label className="field">
          Dev server port
          <input className="input" inputMode="numeric" value={devPort} onChange={(e) => setDevPort(e.target.value.replace(/\D/g, ''))} />
        </label>
      )}
      <div className="row" role="radiogroup" aria-label="Zone colour">
        {ZONES.map((z) => (
          <button
            key={z}
            className="icon-btn"
            role="radio"
            aria-checked={p.color === z}
            aria-label={z}
            onClick={() => api.updateProject(p.id, { color: z })}
            style={{ outline: p.color === z ? '2px solid var(--text)' : undefined }}
          >
            <span className="zone" style={{ background: zoneColor(z), display: 'block' }} />
          </button>
        ))}
      </div>
      <div className="row">
        <button className="btn small primary" onClick={save}>Save</button>
        {p.github && (
          <a className="btn small" href={`https://github.com/${p.github}`} target="_blank" rel="noreferrer">GitHub</a>
        )}
        <span style={{ flex: 1 }} />
        {confirm ? (
          <>
            <span className="proj-meta">Its history stays.</span>
            <button className="btn small danger" onClick={() => api.removeProject(p.id)}>Remove</button>
            <button className="btn small" onClick={() => setConfirm(false)}>Keep</button>
          </>
        ) : (
          <button className="btn small danger" onClick={() => setConfirm(true)}>Remove</button>
        )}
      </div>
    </div>
  )
}

export function ProjectsPanel({
  projects,
  active,
  selected,
  onSelect,
}: {
  projects: Project[]
  active: ActiveSession[]
  selected: string | null
  onSelect: (id: string | null) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [path, setPath] = useState('')
  const [error, setError] = useState('')
  const [scanning, setScanning] = useState(false)

  const add = async () => {
    setError('')
    try {
      await api.addProject(path.trim())
      setPath('')
      setAdding(false)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const stateFor = (id: string) => {
    const s = active.filter((a) => a.projectId === id)
    if (s.some((a) => a.state === 'waiting')) return 'waiting'
    if (s.some((a) => a.state === 'working')) return 'working'
    return s.length ? 'idle' : null
  }

  return (
    <section className="panel" style={{ flex: 1 }} aria-labelledby="projects-title">
      <div className="panel-head">
        <h2 className="panel-title" id="projects-title">Projects</h2>
        <button
          className="btn small"
          disabled={scanning}
          onClick={async () => {
            setScanning(true)
            await api.scan().finally(() => setScanning(false))
          }}
        >
          {scanning ? 'Looking...' : 'Rescan'}
        </button>
        <button className="btn small" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>Add</button>
      </div>
      {adding && (
        <form
          className="proj-edit"
          style={{ paddingTop: 12, borderBottom: '2px solid var(--line)' }}
          onSubmit={(e) => {
            e.preventDefault()
            add()
          }}
        >
          <label className="field">
            Folder path
            <input className="input" autoFocus value={path} placeholder="/home/you/Programming/my-app" onChange={(e) => setPath(e.target.value)} />
          </label>
          {error && <div role="alert" className="chip err">{error}</div>}
          <div className="row"><button className="btn small primary" type="submit" disabled={!path.trim()}>Add project</button></div>
        </form>
      )}
      <div className="scroll">
        {projects.length === 0 && <div className="empty">No projects yet. Rescan, or add a folder.</div>}
        {projects.map((p) => {
          const st = stateFor(p.id)
          return (
            <div key={p.id} className={`proj ${p.enabled ? '' : 'off'}`}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <button className="proj-row" aria-current={selected === p.id} onClick={() => onSelect(selected === p.id ? null : p.id)}>
                  <span className="zone" style={{ background: zoneColor(p.color) }} />
                  <span className="proj-name">{p.name}</span>
                  {st && (
                    <span className={`chip state-${st} ${st === 'working' ? 'pulse' : ''}`}>
                      {st === 'waiting' ? 'Needs you' : st === 'working' ? 'Working' : 'Open'}
                    </span>
                  )}
                </button>
                <button className="icon-btn" aria-label={`Edit ${p.name}`} aria-expanded={editing === p.id} onClick={() => setEditing(editing === p.id ? null : p.id)}>
                  ⋯
                </button>
                <span style={{ paddingRight: 12 }}>
                  <Switch label={`Show ${p.name}`} checked={p.enabled} onChange={(v) => api.updateProject(p.id, { enabled: v })} />
                </span>
              </div>
              {editing === p.id && <ProjectEditor p={p} onDone={() => setEditing(null)} />}
            </div>
          )
        })}
      </div>
    </section>
  )
}
