import { describe, expect, it } from 'vitest'
import { CHAT_WIDTH_MIN, clampChatWidth } from './chatWidth'

describe('clampChatWidth', () => {
  it('passes through a width that already fits', () => {
    expect(clampChatWidth(600, 1600)).toBe(600)
  })

  it('never goes narrower than the floor', () => {
    expect(clampChatWidth(100, 1600)).toBe(CHAT_WIDTH_MIN)
  })

  it('never goes wider than the window, minus its margin', () => {
    expect(clampChatWidth(2000, 1600)).toBe(1576)
  })

  it('still returns the floor on a window narrower than it', () => {
    expect(clampChatWidth(600, 300)).toBe(CHAT_WIDTH_MIN)
  })
})
