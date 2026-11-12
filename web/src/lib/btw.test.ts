import { describe, expect, it } from 'vitest'
import { btwQuestion } from './btw'

describe('btwQuestion', () => {
  it('reads the question after /btw', () => {
    expect(btwQuestion('/btw what does X do?')).toBe('what does X do?')
    expect(btwQuestion('  /BTW  why\nthis? ')).toBe('why\nthis?')
  })

  it('is empty for /btw on its own', () => {
    expect(btwQuestion('/btw')).toBe('')
  })

  it('leaves normal prompts alone', () => {
    expect(btwQuestion('fix the bug')).toBeNull()
    expect(btwQuestion('/btwx no')).toBeNull()
    expect(btwQuestion('btw fix it')).toBeNull()
  })
})
