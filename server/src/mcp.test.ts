import { describe, expect, it, vi } from 'vitest'
import { APPROVE_TOOL, handleMcp } from './mcp.js'
import { promptAnswer } from './approvals.js'

const never = () => Promise.reject(new Error('should not ask'))

describe('handleMcp', () => {
  it('introduces itself in the protocol version it was asked for', async () => {
    const r = await handleMcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, never)
    expect(r).toMatchObject({ id: 1, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} } } })
  })

  it('does not answer notifications', async () => {
    expect(await handleMcp({ jsonrpc: '2.0', method: 'notifications/initialized' }, never)).toBeNull()
  })

  it('lists the one tool', async () => {
    const r = (await handleMcp({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, never)) as { result: { tools: { name: string }[] } }
    expect(r.result.tools.map((t) => t.name)).toEqual([APPROVE_TOOL])
  })

  it('asks HQ and returns the answer as text', async () => {
    const approve = vi.fn(async () => promptAnswer('allow', { command: 'ls' }, true))
    const args = { tool_name: 'Bash', input: { command: 'ls' }, tool_use_id: 't1' }
    const r = (await handleMcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: APPROVE_TOOL, arguments: args } }, approve)) as {
      result: { content: { type: string; text: string }[] }
    }
    expect(approve).toHaveBeenCalledWith(args)
    expect(JSON.parse(r.result.content[0].text)).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } })
  })

  it('refuses unknown tools and methods', async () => {
    expect(await handleMcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'other' } }, never)).toMatchObject({ error: { code: -32602 } })
    expect(await handleMcp({ jsonrpc: '2.0', id: 5, method: 'resources/list' }, never)).toMatchObject({ error: { code: -32601 } })
  })
})

describe('promptAnswer', () => {
  it('refuses the step when nobody says yes, since there is no terminal to ask in', () => {
    expect(promptAnswer('deny', {}, true)).toMatchObject({ behavior: 'deny' })
    expect(promptAnswer(null, {}, true)).toMatchObject({ behavior: 'deny', message: expect.stringContaining('in time') })
    expect(promptAnswer(null, {}, false)).toMatchObject({ behavior: 'deny', message: expect.stringContaining('not open') })
  })
})
