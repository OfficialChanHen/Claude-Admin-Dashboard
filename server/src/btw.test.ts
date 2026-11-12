import { describe, expect, it, vi } from 'vitest'

vi.mock('./db.js', () => ({ get: vi.fn() }))

const { btwAnswer, btwArgs, btwPrompt, parseBtw } = await import('./btw.js')

describe('parseBtw', () => {
  it('needs a question that is not huge', () => {
    expect(parseBtw({ text: '  ' })).toEqual({ error: 'Write a question first.' })
    expect(parseBtw({ text: 7 })).toEqual({ error: 'Write a question first.' })
    expect(parseBtw({ text: 'x'.repeat(4_001) })).toEqual({ error: 'That question is too long.' })
    expect(parseBtw({ text: ' why? ' })).toEqual({ text: 'why?' })
  })
})

describe('btwArgs', () => {
  it('forks the session without saving it, with no hooks and one turn', () => {
    const args = btwArgs('sess-1', 'claude-opus-5-5')
    expect(args).toEqual(expect.arrayContaining(['-p', '--fork-session', '--no-session-persistence']))
    expect(args.slice(args.indexOf('--resume'), args.indexOf('--resume') + 2)).toEqual(['--resume', 'sess-1'])
    expect(args.slice(args.indexOf('--max-turns'), args.indexOf('--max-turns') + 2)).toEqual(['--max-turns', '1'])
    // Any tool it reaches for is refused, never asked about.
    expect(args.slice(args.indexOf('--permission-mode'), args.indexOf('--permission-mode') + 2)).toEqual(['--permission-mode', 'dontAsk'])
    expect(JSON.parse(args[args.indexOf('--settings') + 1])).toEqual({ disableAllHooks: true })
    expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2)).toEqual(['--model', 'claude-opus-5-5'])
  })

  it('keeps the tool list, so the cached conversation is reused', () => {
    expect(btwArgs('s', null)).not.toContain('--tools')
    expect(btwArgs('s', null)).not.toContain('--model')
  })

  it('keeps a long context model long, so a big conversation still fits', () => {
    const args = btwArgs('s', 'claude-opus-5-5[1m]')
    expect(args[args.indexOf('--model') + 1]).toBe('claude-opus-5-5[1m]')
  })
})

describe('btwPrompt', () => {
  it('marks the question as a side question in the prompt itself', () => {
    const p = btwPrompt('what is X?')
    expect(p).toContain('what is X?')
    expect(p).toMatch(/side question/i)
  })
})

describe('btwAnswer', () => {
  it('reads the answer from the CLI result', () => {
    expect(btwAnswer(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'It is Y.' }))).toEqual({ answer: 'It is Y.' })
  })

  it('explains a question that needed tools', () => {
    expect(btwAnswer(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true }))).toEqual({
      error: 'That needs them to look something up. Ask it as a normal prompt instead.',
    })
  })

  it('fails gently on output it cannot read', () => {
    expect(btwAnswer('not json')).toEqual({ error: 'Claude did not answer. Try again.' })
    expect(btwAnswer(JSON.stringify({ type: 'result', is_error: true, result: 'Rate limited' }))).toEqual({ error: 'Rate limited' })
  })
})
