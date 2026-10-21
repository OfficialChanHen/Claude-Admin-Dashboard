import { useEffect, useState } from 'react'
import type { Approval } from '../lib/api'
import { askNotifyPermission, soonestHeadless } from '../lib/alerts'
import { PixelIcon } from './PixelIcon'

/**
 * The "Needs your OK" plate: big, in your-turn pink and pulsing while anything
 * waits. Requests from sessions HQ started are refused when time runs out, so
 * the plate counts down the one that runs out first. The speaker next to it
 * turns the arrival blip on and off.
 */
export function NeedsOk({
  approvals, open, muted, onToggle, onMute,
}: {
  approvals: Approval[]
  open: boolean
  muted: boolean
  onToggle: () => void
  onMute: (muted: boolean) => void
}) {
  const [now, setNow] = useState(Date.now())
  const headless = approvals.some((a) => a.headless)
  useEffect(() => {
    if (!headless) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [headless])

  const left = soonestHeadless(approvals, now)
  return (
    <div className="needs-ok-group">
      <button
        className="queue-plate hud-plate needs-ok"
        aria-expanded={open}
        onClick={() => {
          askNotifyPermission()
          onToggle()
        }}
      >
        <PixelIcon name="question" size={16} />
        Needs your OK ({approvals.length})
        {left !== null && <span className={`needs-ok-left ${left <= 15 ? 'soon' : ''}`}>{left}s</span>}
      </button>
      <button
        className="queue-plate hud-plate needs-ok-mute"
        aria-pressed={muted}
        aria-label={muted ? 'Turn the request sound on' : 'Mute the request sound'}
        title={muted ? 'Sound off' : 'Sound on'}
        onClick={() => {
          askNotifyPermission()
          onMute(!muted)
        }}
      >
        <PixelIcon name={muted ? 'muted' : 'sound'} size={14} />
      </button>
    </div>
  )
}
