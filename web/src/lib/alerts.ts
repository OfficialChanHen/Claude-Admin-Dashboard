import type { Approval } from './api'

// Getting your attention when a session asks for your OK: the tab title, a
// browser notification and a short blip. Only requests that arrive while HQ is
// open count as new; the list that comes with a (re)connect stays quiet.

export const BASE_TITLE = 'Claude HQ'

/** "(2) Claude HQ" while requests wait, the plain title otherwise. */
export function pendingTitle(count: number, base = BASE_TITLE) {
  return count > 0 ? `(${count}) ${base}` : base
}

/** True when a live approval event is one we haven't seen yet. */
export function isNewApproval(known: Iterable<string>, a: Approval) {
  for (const id of known) if (id === a.id) return false
  return true
}

/** Seconds left on the headless request that runs out first, or null when none wait. */
export function soonestHeadless(approvals: Approval[], now: number) {
  const left = approvals.filter((a) => a.headless).map((a) => Math.max(0, Math.ceil((a.expiresAt - now) / 1000)))
  return left.length ? Math.min(...left) : null
}

/** What the browser notification says. */
export function notifyText(a: Approval, name: string) {
  return { title: `${name} needs your OK`, body: a.summary ? `${a.tool}: ${a.summary}` : a.tool }
}

const MUTE_KEY = 'hq.approvalSound.muted'

export function loadMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

export function saveMuted(muted: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
  } catch {
    // Private windows may refuse; the setting just won't stick.
  }
}

let audio: AudioContext | null = null

/** Two quick rising tones, made in code so there is no sound file. */
export function blip() {
  try {
    audio ??= new AudioContext()
    if (audio.state === 'suspended') void audio.resume()
    const t = audio.currentTime
    for (const [i, freq] of [660, 880].entries()) {
      const osc = audio.createOscillator()
      const gain = audio.createGain()
      osc.type = 'square'
      osc.frequency.value = freq
      const start = t + i * 0.09
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.06, start + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.08)
      osc.connect(gain).connect(audio.destination)
      osc.start(start)
      osc.stop(start + 0.09)
    }
  } catch {
    // No audio here; the title and notification still tell you.
  }
}

/** Asks once for notification permission. Call it from a click; browsers ignore it on page load. */
export function askNotifyPermission() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission()
}

/** Shows a notification; clicking it focuses HQ and runs onClick. */
export function notifyApproval(a: Approval, name: string, onClick: () => void) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const { title, body } = notifyText(a, name)
  const n = new Notification(title, { body, tag: a.id })
  n.onclick = () => {
    window.focus()
    onClick()
    n.close()
  }
}
