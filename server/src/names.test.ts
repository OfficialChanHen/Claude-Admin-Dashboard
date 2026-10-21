import { describe, expect, it } from 'vitest'
import { helperName, nameSessions, taskTitle } from './names.js'

describe('taskTitle', () => {
  it('names a session after the first sentence of its prompt', () => {
    expect(taskTitle('Fix the login redirect. It loops forever on Safari.')).toBe('Fix the login redirect')
  })

  it('drops the polite opener', () => {
    expect(taskTitle('Hey, can you please add dark mode to the settings page?')).toBe('Add dark mode to the settings page')
    expect(taskTitle("I'd like you to tidy up the README")).toBe('Tidy up the README')
  })

  it('cuts a long prompt at a word, with an ellipsis', () => {
    const t = taskTitle('Give every commit and agent a message that is human readable and related to their task')!
    expect(t.length).toBeLessThanOrEqual(49)
    expect(t.endsWith('…')).toBe(true)
    expect(t).toMatch(/^Give every commit and agent a message/)
    expect(t).not.toMatch(/\s…$/)
  })

  it('skips HQ headers, tags, code and links', () => {
    expect(taskTitle('[A message from the boss]\n\nRebase onto main')).toBe('Rebase onto main')
    expect(taskTitle('<pasted_content id="x">error at line 3</pasted_content>\nwhy does this fail')).toBe('Why does this fail')
    expect(taskTitle('```\nTypeError\n```\nsee https://example.com/x then fix it')).toBe('See then fix it')
  })

  it('reads list items and markdown as plain words', () => {
    expect(taskTitle('- **Speed up** the tests')).toBe('Speed up the tests')
  })

  it('gives up on prompts with no words', () => {
    expect(taskTitle('   ')).toBeNull()
    expect(taskTitle('???')).toBeNull()
  })
})

describe('helperName', () => {
  it('uses the task it was given', () => {
    expect(helperName('Commit and push office world', 'general-purpose')).toBe('Commit and push office world')
  })

  it('falls back to a readable kind of helper', () => {
    expect(helperName(null, 'general-purpose')).toBe('Helper')
    expect(helperName('', 'Explore')).toBe('Explorer')
    expect(helperName(null, 'code-reviewer')).toBe('Code reviewer')
    expect(helperName(null, null)).toBe('Helper')
  })
})

describe('nameSessions', () => {
  const names = new Map([
    ['04bd3ece-1111-2222-3333-444455556666', 'Make reports easier to read'],
    ['20c0ea0a-1111-2222-3333-444455556666', 'Cut token use'],
  ])

  it('replaces "Untitled (id)" with the name', () => {
    expect(nameSessions('Untitled (04bd3ece) has just started.', names)).toBe('"Make reports easier to read" has just started.')
  })

  it('replaces bare and full ids', () => {
    expect(nameSessions('04bd3ece and 20c0ea0a-1111-2222-3333-444455556666 both edit hierarchy.ts', names)).toBe(
      '"Make reports easier to read" and "Cut token use" both edit hierarchy.ts',
    )
  })

  it('drops a session id after a name', () => {
    expect(nameSessions('"Cut token use" (session 20c0ea0a) is done', names)).toBe('"Cut token use" is done')
  })

  it('leaves ids it does not know, and other hex words, alone', () => {
    expect(nameSessions('Untitled (deadbeef) pushed 5189e20', names)).toBe('Untitled (deadbeef) pushed 5189e20')
  })
})
