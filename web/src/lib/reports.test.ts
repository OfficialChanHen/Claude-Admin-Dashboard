import { describe, expect, it } from 'vitest'
import { headline, splitReport } from './reports'

describe('splitReport', () => {
  it('lifts out what needs you and keeps the rest in order', () => {
    const r = splitReport([
      'Two agents are busy.',
      '- **"Fix the camera"**: zoom now stops at the whole office.',
      '- **Needs you:** approve the "portfolio" agent\'s edit in HQ.',
      '- **Watch:** both agents change render.ts.',
    ].join('\n'))
    expect(r.needsYou).toEqual(['approve the "portfolio" agent\'s edit in HQ.'])
    expect(r.body).toBe('Two agents are busy.\n- **"Fix the camera"**: zoom now stops at the whole office.\n- **Watch:** both agents change render.ts.')
  })

  it('accepts the colon inside or outside the bold, and no bullet', () => {
    expect(splitReport('**Needs you**: reply to it').needsYou).toEqual(['reply to it'])
    expect(splitReport('* **needs you:** reply').needsYou).toEqual(['reply'])
  })

  it('leaves a report with nothing for you as it is', () => {
    expect(splitReport('All quiet.')).toEqual({ needsYou: [], body: 'All quiet.' })
  })
})

describe('headline', () => {
  it('is the first sentence, without markdown', () => {
    expect(headline('- **HQ** is busy. Two agents.\nMore')).toBe('HQ is busy.')
  })
  it('is cut when long', () => {
    expect(headline('a'.repeat(200), 20)).toHaveLength(20)
  })
})
