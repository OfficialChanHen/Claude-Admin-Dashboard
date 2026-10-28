import { useEffect, useRef } from 'react'
import { PORTRAIT, drawPortrait, loadSheets } from '../world/render'

/** Someone from the office, drawn from the same sheet as the world. */
export function Portrait({ row, scale = 3, label }: { row: number; scale?: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let live = true
    loadSheets().then((sheets) => {
      if (live && ref.current) drawPortrait(ref.current, sheets, row, scale)
    })
    return () => {
      live = false
    }
  }, [row, scale])
  return (
    <canvas
      ref={ref}
      className="portrait"
      role="img"
      aria-label={label}
      width={PORTRAIT.w * scale}
      height={PORTRAIT.h * scale}
      style={{ width: PORTRAIT.w * scale, height: PORTRAIT.h * scale }}
    />
  )
}
