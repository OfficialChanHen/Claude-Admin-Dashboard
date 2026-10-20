import { iconCells, type IconName } from '../lib/pixelIcons'

/** A 7 by 7 pixel icon in the current text colour. */
export function PixelIcon({ name, size = 14 }: { name: IconName; size?: number }) {
  return (
    <svg className="pixel-icon" width={size} height={size} viewBox="0 0 7 7" aria-hidden shapeRendering="crispEdges" fill="currentColor">
      {iconCells(name).map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />
      ))}
    </svg>
  )
}
