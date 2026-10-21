import { describe, expect, it } from 'vitest'
import { CHATS, LINES, detail, lineFor, topicFor, type Scene } from './chatter'

// A Wednesday at 2pm, so morning, late and Friday lines stay out of the way.
const NOON = new Date(2026, 9, 21, 14, 0).getTime()
const coin = (v: number) => () => v

function scene(over: Partial<Scene> = {}): Scene {
  return {
    rank: 'senior', role: null, activity: 'work', state: 'working', station: 'desk',
    running: false, tool: null, summary: '', spot: null, asleep: false, now: NOON, ...over,
  }
}

describe('topicFor', () => {
  it('talks about the break spot they are at', () => {
    for (const spot of ['coffee', 'vending', 'table', 'sofa', 'window', 'plant'] as const) {
      expect(topicFor(scene({ activity: 'break', spot }), coin(0.9))).toBe(spot)
    }
  })

  it('has morning and late lines at the coffee', () => {
    const morning = new Date(2026, 9, 21, 9, 0).getTime()
    const late = new Date(2026, 9, 21, 22, 0).getTime()
    expect(topicFor(scene({ activity: 'break', spot: 'coffee', now: morning }), coin(0.1))).toBe('morning')
    expect(topicFor(scene({ activity: 'break', spot: 'vending', now: late }), coin(0.1))).toBe('late')
  })

  it('talks about the work in hand', () => {
    expect(topicFor(scene({ running: true, tool: 'Read', summary: 'src/a.ts' }), coin(0.9))).toBe('read')
    expect(topicFor(scene({ running: true, tool: 'Bash', summary: 'npm test' }), coin(0.9))).toBe('test')
    expect(topicFor(scene({ running: true, tool: 'Edit', summary: 'web/src/styles.css' }), coin(0.9))).toBe('css')
    expect(topicFor(scene({ running: true, tool: 'AskUserQuestion' }), coin(0.9))).toBe('waiting')
  })

  it('thinks while working, idles when idle, and waits on you', () => {
    expect(topicFor(scene(), coin(0.9))).toBe('think')
    expect(topicFor(scene({ state: 'idle' }), coin(0.9))).toBe('idle')
    expect(topicFor(scene({ state: 'waiting' }), coin(0.9))).toBe('waiting')
  })

  it('gives the boss and managers their own lines', () => {
    expect(topicFor(scene({ role: 'boss', state: 'idle' }), coin(0.1))).toBe('boss')
    expect(topicFor(scene({ role: 'manager' }), coin(0.1))).toBe('manager')
  })

  it('stays quiet asleep, walking in or leaving', () => {
    expect(topicFor(scene({ asleep: true, state: 'idle' }), coin(0.5))).toBeNull()
    expect(topicFor(scene({ activity: 'arrive' }), coin(0.5))).toBeNull()
    expect(topicFor(scene({ activity: 'leave' }), coin(0.5))).toBeNull()
    expect(topicFor(scene({ activity: 'break' }), coin(0.5))).toBeNull()
  })
})

describe('detail', () => {
  it.each([
    ['Bash', 'npx vitest run', 'test'], ['Bash', 'npm install react', 'install'], ['Bash', 'tsc --noEmit', 'build'],
    ['Bash', 'git status', 'git'], ['Bash', 'npx eslint .', 'lint'], ['Bash', 'ls', null],
    ['Edit', 'src/model.test.ts', 'testfile'], ['Write', 'README.md', 'docs'], ['Edit', 'package.json', 'config'],
    ['Read', 'notes.md', null],
  ])('%s %s is %s', (tool, summary, topic) => {
    expect(detail(tool, summary)).toBe(topic)
  })
})

describe('lines', () => {
  it('never repeats the last line', () => {
    const first = lineFor('coffee', coin(0))
    expect(lineFor('coffee', coin(0), first)).not.toBe(first)
  })

  it('keeps to the house style: no dashes or middle dots, and short enough for a bubble', () => {
    const all = [...Object.values(LINES).flat(), ...CHATS.flat()]
    for (const l of all) {
      expect(l).not.toMatch(/[—–·]/)
      expect(l.length).toBeLessThanOrEqual(60)
    }
    for (const pool of Object.values(LINES)) expect(pool.length).toBeGreaterThan(1)
  })
})
