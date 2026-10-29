import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// The prompt module reads the session list from the database; tests use a stand-in.
vi.mock('./db.js', () => ({ get: vi.fn(() => ({ id: 'sess-1' })), run: vi.fn() }))
vi.mock('./config.js', () => ({ DATA_DIR: '/tmp', PORT: 4317 }))
vi.mock('./stop.js', () => ({ notePid: vi.fn(), isRunning: vi.fn() }))
vi.mock('./transcripts.js', () => ({ setSessionState: vi.fn(), noteJoined: vi.fn() }))

const { claudeArgs, claudeEnv, joinTask, parsePrompt, sessionTarget, startPrompt, turnEnded, userLine } = await import('./prompt.js')
const { noteJoined } = await import('./transcripts.js')

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
    expect(parsePrompt({ projectId: 'p', text: ' fix it ' })).toEqual({ projectId: 'p', text: 'fix it', mode: 'new', permissionMode: 'auto' })
  })

  it('never allows skipping permissions', () => {
    const r = parsePrompt({ projectId: 'p', text: 'x', permissionMode: 'bypassPermissions' })
    expect(r).toMatchObject({ permissionMode: 'auto' })
  })

  it('keeps plan mode and continue when asked', () => {
    expect(parsePrompt({ projectId: 'p', text: 'x', mode: 'continue', permissionMode: 'plan' })).toMatchObject({ mode: 'continue', permissionMode: 'plan' })
  })

  it('carries on the session you picked, with or without a project', () => {
    expect(parsePrompt({ sessionId: 's', text: 'x', mode: 'new' })).toEqual({ projectId: '', sessionId: 's', text: 'x', mode: 'continue', permissionMode: 'auto' })
    expect(parsePrompt({ projectId: 'p', sessionId: 's', text: 'x' })).toMatchObject({ projectId: 'p', sessionId: 's', mode: 'continue' })
    expect(parsePrompt({ projectId: 'p', text: 'x' })).not.toHaveProperty('sessionId')
  })

  it('starts a chat about no project, which asks before doing anything', () => {
    expect(parsePrompt({ chat: true, text: 'hi' })).toEqual({ projectId: '', chat: true, text: 'hi', mode: 'new', permissionMode: 'auto' })
    expect(parsePrompt({ chat: true, projectId: 'p', text: 'x', permissionMode: 'plan', mode: 'continue' })).toMatchObject({ projectId: '', mode: 'continue', permissionMode: 'auto' })
    expect(parsePrompt({ chat: 'yes', text: 'x' })).toEqual({ error: 'Pick a project first.' })
    expect(parsePrompt({ projectId: 'p', text: 'x' })).not.toHaveProperty('chat')
  })

  it('sends to the session you picked even from a chat', () => {
    expect(parsePrompt({ chat: true, sessionId: 's', text: 'x' })).not.toHaveProperty('chat')
  })

  it('keeps the model you picked, and leaves out one it does not know', () => {
    expect(parsePrompt({ projectId: 'p', text: 'x', model: 'haiku' })).toMatchObject({ model: 'haiku' })
    expect(parsePrompt({ chat: true, text: 'x', model: 'opus' })).toMatchObject({ model: 'opus' })
    expect(parsePrompt({ projectId: 'p', text: 'x', model: '--dangerously-skip-permissions' })).not.toHaveProperty('model')
    expect(parsePrompt({ projectId: 'p', text: 'x' })).not.toHaveProperty('model')
  })
})

describe('sessionTarget', () => {
  const row = { project_id: 'p', cwd: '/work/p/sub', state: 'idle' }

  it('runs in the project folder, or where the session ran when it has no project', () => {
    expect(sessionTarget(row, '/work/p')).toEqual({ cwd: '/work/p', projectId: 'p' })
    expect(sessionTarget({ ...row, project_id: null }, null)).toEqual({ cwd: '/work/p/sub', projectId: '' })
    expect(sessionTarget({ ...row, state: 'ended' }, '/work/p')).toMatchObject({ cwd: '/work/p' })
  })

  it('waits for someone who is mid-task', () => {
    expect(sessionTarget({ ...row, state: 'working' }, '/work/p')).toMatchObject({ busy: true })
    expect(sessionTarget({ ...row, state: 'waiting' }, '/work/p')).toMatchObject({ busy: true })
  })

  it('refuses a session it cannot place', () => {
    expect(sessionTarget(undefined, null)).toHaveProperty('error')
    expect(sessionTarget({ ...row, project_id: null, cwd: null }, null)).toHaveProperty('error')
  })
})

describe('claudeArgs', () => {
  const req = { projectId: 'p', text: 'fix the login', mode: 'new' as const, permissionMode: 'acceptEdits' as const }

  it('runs headless with the chosen permission mode', () => {
    expect(claudeArgs(req, null)).toEqual(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits'])
  })

  it('resumes only when continuing and there is a session to continue', () => {
    expect(claudeArgs({ ...req, mode: 'continue' }, 'sess-1').slice(0, 10)).toEqual(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--resume', 'sess-1'])
    expect(claudeArgs({ ...req, mode: 'continue' }, null)).not.toContain('--resume')
    expect(claudeArgs(req, 'sess-1')).not.toContain('--resume')
  })

  it('runs on the model you picked, or your usual one when you picked none', () => {
    expect(claudeArgs({ ...req, model: 'sonnet' }, null)).toEqual(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--model', 'sonnet'])
    expect(claudeArgs(req, null)).not.toContain('--model')
  })

  it('names a new session up front, so it can be stopped later', () => {
    expect(claudeArgs(req, null, 'new-id').slice(0, 10)).toEqual(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--session-id', 'new-id'])
    expect(claudeArgs({ ...req, mode: 'continue' }, 'sess-1', 'sess-1')).not.toContain('--session-id')
  })

  it('sends permission requests to HQ, for the session it runs', () => {
    const args = claudeArgs(req, null, 'new-id')
    expect(args.slice(10, 12)).toEqual(['--permission-prompt-tool', 'mcp__claude_hq__approve'])
    // --mcp-config takes several values, so nothing may follow it.
    expect(args.at(-2)).toBe('--mcp-config')
    expect(JSON.parse(args.at(-1)!)).toEqual({ mcpServers: { claude_hq: { type: 'http', url: 'http://127.0.0.1:4317/mcp/new-id' } } })
    expect(claudeArgs({ ...req, mode: 'continue' }, 'sess-1').at(-1)).toContain('/mcp/sess-1')
  })

  it('never puts the prompt on the command line, so it cannot be read as a flag', () => {
    const args = claudeArgs({ ...req, text: '--dangerously-skip-permissions' }, null)
    expect(args).not.toContain('--dangerously-skip-permissions')
    expect(args.some((a) => a.includes('skip'))).toBe(false)
  })
})

describe('stream JSON', () => {
  it('sends each prompt as one user line', () => {
    const line = userLine('fix it\nplease')
    expect(line.endsWith('\n')).toBe(true)
    expect(line.slice(0, -1)).not.toContain('\n')
    expect(JSON.parse(line)).toEqual({ type: 'user', message: { role: 'user', content: 'fix it\nplease' } })
  })

  it('sees the end of a turn, and nothing else', () => {
    expect(turnEnded('{"type":"assistant"}\n{"type":"result","subtype":"success"}')).toBe(true)
    expect(turnEnded('{"type":"assistant","message":{"content":"the result"}}')).toBe(false)
    expect(turnEnded('{"type":"res')).toBe(false)
  })
})

describe('prompting mid-task', () => {
  it('hands a prompt to a running task until its turn ends, then lets it finish', async () => {
    // A stand-in for claude: ends its turn soon, then keeps every line it got until stdin closes.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-mid-'))
    const got = path.join(dir, 'got.jsonl')
    const bin = path.join(dir, 'claude')
    fs.writeFileSync(bin, `#!/usr/bin/env node
const fs = require('fs')
let all = ''
process.stdin.on('data', (d) => (all += d))
process.stdin.on('end', () => fs.writeFileSync(${JSON.stringify(got)}, all))
setTimeout(() => console.log(JSON.stringify({ type: 'result', subtype: 'success' })), 300)
`, { mode: 0o755 })
    process.env.HQ_CLAUDE_BIN = bin
    const exited = new Promise<void>((resolve) => {
      startPrompt({ projectId: 'p', text: 'first', mode: 'new', permissionMode: 'auto' }, dir, undefined, { newId: 'mid-1', onExit: resolve })
    })
    expect(joinTask('mid-1', 'also this')).toBe(true)
    // It is in the chat from now, not from when Claude reads it.
    expect(noteJoined).toHaveBeenCalledWith('mid-1', 'p', 'also this')
    await exited
    expect(fs.readFileSync(got, 'utf8').trim().split('\n').map((l) => JSON.parse(l).message.content)).toEqual(['first', 'also this'])
    expect(joinTask('mid-1', 'too late')).toBe(false)
    expect(noteJoined).toHaveBeenCalledTimes(1)
    delete process.env.HQ_CLAUDE_BIN
  }, 10_000)

  it('cannot reach a session HQ is not running', () => {
    expect(joinTask('someone-in-a-terminal', 'hi')).toBe(false)
  })
})

describe('claudeEnv', () => {
  const base = { PATH: '/bin', CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' }

  it('keeps every helper on Haiku when you picked Haiku', () => {
    expect(claudeEnv('haiku', base)).toEqual({ PATH: '/bin', CLAUDE_CODE_SUBAGENT_MODEL: 'haiku', CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' })
  })

  it('leaves helpers to your usual settings for any other pick', () => {
    expect(claudeEnv(undefined, base)).toEqual(base)
    expect(claudeEnv('sonnet', base)).toEqual(base)
    expect(claudeEnv('opus', base)).toEqual(base)
  })
})
