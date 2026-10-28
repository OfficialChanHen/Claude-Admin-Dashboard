export const CHAT_WIDTH_MIN = 320
export const CHAT_WIDTH_DEFAULT = 440

/** Keeps a dragged width wide enough to read and narrow enough to fit the window. */
export function clampChatWidth(px: number, viewportWidth: number): number {
  const max = Math.max(CHAT_WIDTH_MIN, viewportWidth - 24)
  return Math.min(max, Math.max(CHAT_WIDTH_MIN, px))
}
