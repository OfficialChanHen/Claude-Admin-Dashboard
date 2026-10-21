import type { PromptAnswer } from './approvals.js'

// A tiny MCP server over HTTP with one tool: the permission prompt for the
// sessions HQ starts. `claude -p` has no terminal to ask in, so HQ starts it
// with --permission-prompt-tool and Claude Code calls this tool whenever a step
// needs your OK. The answer comes from Allow and Deny in HQ.

export const MCP_SERVER = 'claude_hq'
export const APPROVE_TOOL = 'approve'
export const PROMPT_TOOL = `mcp__${MCP_SERVER}__${APPROVE_TOOL}`

export type PromptInput = { tool_name?: unknown; input?: unknown; tool_use_id?: unknown }
type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string } }

/** More tools for one session, such as a manager's report and prompt tools (see hierarchy.ts). */
export type ExtraTools = {
  tools: { name: string; description: string; inputSchema: object }[]
  call: (name: string, args: Record<string, unknown>) => Promise<string>
}

const TOOL = {
  name: APPROVE_TOOL,
  description: 'Claude HQ calls this to ask the user before a step runs. Claude Code calls it for you; never call it yourself.',
  inputSchema: {
    type: 'object',
    properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } },
    required: ['tool_name', 'input'],
  },
}

/** One JSON-RPC message in, its reply out. Notifications get no reply. */
export async function handleMcp(msg: Rpc, approve: (p: PromptInput) => Promise<PromptAnswer>, extra?: ExtraTools): Promise<object | null> {
  if (msg?.id === undefined || msg.id === null) return null
  const ok = (result: object) => ({ jsonrpc: '2.0', id: msg.id, result })
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id, error: { code, message } })
  switch (msg.method) {
    case 'initialize':
      return ok({
        protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'claude-hq', version: '1.0.0' },
      })
    case 'ping':
      return ok({})
    case 'tools/list':
      return ok({ tools: [TOOL, ...(extra?.tools ?? [])] })
    case 'tools/call': {
      const name = msg.params?.name
      if (extra && name && extra.tools.some((t) => t.name === name)) {
        const text = await extra.call(name, msg.params?.arguments ?? {})
        return ok({ content: [{ type: 'text', text }] })
      }
      if (name !== APPROVE_TOOL) return fail(-32602, 'Unknown tool.')
      const answer = await approve(msg.params?.arguments ?? {})
      return ok({ content: [{ type: 'text', text: JSON.stringify(answer) }] })
    }
    default:
      return fail(-32601, 'Method not found.')
  }
}

/** The CLI flags that send a session's permission prompts to HQ. */
export function promptToolArgs(sessionId: string, port: number) {
  const config = { mcpServers: { [MCP_SERVER]: { type: 'http', url: `http://127.0.0.1:${port}/mcp/${sessionId}` } } }
  // --mcp-config takes several values, so it goes last.
  return ['--permission-prompt-tool', PROMPT_TOOL, '--mcp-config', JSON.stringify(config)]
}
