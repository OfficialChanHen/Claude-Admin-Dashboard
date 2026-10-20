import { useEffect, useRef, useState } from 'react'
import type { LiveEvent, Limits } from './api'

// One websocket to the HQ server, reconnecting with backoff.
export function useLive(onEvent: (ev: LiveEvent) => void) {
  const [connected, setConnected] = useState(false)
  const [limits, setLimits] = useState<Limits | null>(null)
  const handler = useRef(onEvent)
  handler.current = onEvent

  useEffect(() => {
    let ws: WebSocket | null = null
    let stopped = false
    let delay = 500
    let timer: ReturnType<typeof setTimeout>

    const open = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${location.host}/ws`)
      ws.onopen = () => {
        setConnected(true)
        delay = 500
      }
      ws.onmessage = (m) => {
        const ev = JSON.parse(m.data) as LiveEvent
        if (ev.kind === 'hello') {
          setLimits(ev.limits)
          ev.recent.forEach((e) => handler.current(e))
        } else if (ev.kind === 'limits') {
          setLimits(ev.limits)
        }
        handler.current(ev)
      }
      ws.onclose = () => {
        setConnected(false)
        if (stopped) return
        timer = setTimeout(open, delay)
        delay = Math.min(delay * 2, 8000)
      }
    }
    open()
    return () => {
      stopped = true
      clearTimeout(timer)
      ws?.close()
    }
  }, [])

  return { connected, limits }
}

export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}
