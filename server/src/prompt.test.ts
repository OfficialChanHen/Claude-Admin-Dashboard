import { describe, expect, it, vi } from 'vitest'

// The prompt module reads the session list from the database; tests use a stand-in.
vi.mock('./db.js', () => ({ get: vi.fn(() => ({ id: 'sess-1' })) }))
vi.mock('./config.js', () => ({ DATA_DIR: '/tmp' }))

const { claudeArgs, parsePrompt } = await import('./prompt.js')

describe('parsePrompt', () => {
  it('needs a project and some text', () => {
    expect(parsePrompt({ text: 'hi' })).toEqual({ error: 'Pick a project first.' })
    expect(parsePrompt({ projectId: 'p', text: '   ' })).toEqual({ error: 'Write a prompt first.' })
    expect(parsePrompt({ projectId: 'p', text: 42 })).toEqual({ error: 'Write a prompt first.' })
  })

  it('refuses a huge prompt', () => {
    expect(parsePrompt({ projectId: 'p', text: 'x'.repeat(20_001) })).toEqual({ error: 'That prompt is too long.' })
  })

  it('defaults to a new task that can edit files', () => {
    expect(parsePrompt({ projectId: 'p', text: ' fix it ' })).toEqual({ projectId: 'p', text: 'fix it', mode: 'new', permissionMode: 'acceptEdits' })
  })

  it('never allows skipping permissions', () => {
    const r = parsePrompt({ projectId: 'p', text: 'x', permissionMode: 'bypassPermissions' })
    expect(r).toMatchObject({ permissionMode: 'acceptEdits' })
  })

  it('keeps plan mode and continue when asked', () => {
    expect(parsePrompt({ projectId: 'p', text: 'x', mode: 'continue', permissionMode: 'plan' })).toMatchObject({ mode: 'continue', permissionMode: 'plan' })
  })
})

describe('claudeArgs', () => {
  const req = { projectId: 'p', text: 'fix the login', mode: 'new' as const, permissionMode: 'acceptEdits' as const }

  it('runs headless with the chosen permission mode', () => {
    expect(claudeArgs(req, null)).toEqual(['-p', '--permission-mode', 'acceptEdits'])
  })

  it('resumes only when continuing and there is a session to continue', () => {
    expect(claudeArgs({ ...req, mode: 'continue' }, 'sess-1')).toEqual(['-p', '--permission-mode', 'acceptEdits', '--resume', 'sess-1'])
    expect(claudeArgs({ ...req, mode: 'continue' }, null)).not.toContain('--resume')
    expect(claudeArgs(req, 'sess-1')).not.toContain('--resume')
  })

  it('never puts the prompt on the command line, so it cannot be read as a flag', () => {
    const args = claudeArgs({ ...req, text: '--dangerously-skip-permissions' }, null)
    expect(args).not.toContain('--dangerously-skip-permissions')
    expect(args.some((a) => a.includes('skip'))).toBe(false)
  })
})
