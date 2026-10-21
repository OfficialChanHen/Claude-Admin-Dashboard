import { describe, expect, it } from 'vitest'
import type { Approval } from './api'
import { isNewApproval, notifyText, pendingTitle, soonestHeadless } from './alerts'

const ask = (over: Partial<Approval>): Approval => ({
  id: 'a1', sessionId: 's1', projectId: null, tool: 'Bash', summary: 'npm test', detail: '', ts: 0, expiresAt: 50_000, ...over,
})

describe('pendingTitle', () => {
  it('shows the count while requests wait', () => {
    expect(pendingTitle(2)).toBe('(2) Claude HQ')
    expect(pendingTitle(1, 'HQ')).toBe('(1) HQ')
  })
  it('goes back to the plain title when nothing waits', () => {
    expect(pendingTitle(0)).toBe('Claude HQ')
  })
})

describe('isNewApproval', () => {
  it('is new only when the id has not been seen', () => {
    expect(isNewApproval([], ask({}))).toBe(true)
    expect(isNewApproval(new Set(['a2']), ask({}))).toBe(true)
    expect(isNewApproval(new Set(['a1']), ask({}))).toBe(false)
  })
})

describe('soonestHeadless', () => {
  it('counts down the headless request that runs out first', () => {
    const list = [ask({ id: 'a', headless: true, expiresAt: 30_500 }), ask({ id: 'b', headless: true, expiresAt: 12_000 }), ask({ id: 'c', expiresAt: 1000 })]
    expect(soonestHeadless(list, 10_000)).toBe(2)
  })
  it('is null with no headless requests, and never negative', () => {
    expect(soonestHeadless([ask({})], 0)).toBeNull()
    expect(soonestHeadless([ask({ headless: true, expiresAt: 0 })], 5000)).toBe(0)
  })
})

describe('notifyText', () => {
  it('says who is asking and what', () => {
    expect(notifyText(ask({}), 'Fix login')).toEqual({ title: 'Fix login needs your OK', body: 'Bash: npm test' })
    expect(notifyText(ask({ summary: '' }), 'Manager').body).toBe('Bash')
  })
})
