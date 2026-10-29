import { describe, expect, it } from 'vitest'
import { rememberModel, startingModel } from './promptModel'

describe('which model a prompt starts on', () => {
  it('a new task starts on the model you last picked', () => {
    expect(startingModel(false, 'haiku')).toBe('haiku')
  })

  it('a reply to someone starts on Default, whatever you last picked', () => {
    expect(startingModel(true, 'haiku')).toBe('default')
  })

  it('only a pick for a new task is remembered', () => {
    expect(rememberModel(false)).toBe(true)
    expect(rememberModel(true)).toBe(false)
  })
})
