import { EventEmitter } from 'node:events'

// Everything the UI animates goes through here and out over the websocket.
export type LiveEvent =
  | { kind: 'prompt'; sessionId: string; projectId: string | null; agentId: string | null; text: string; ts: number }
  | { kind: 'action'; sessionId: string; projectId: string | null; agentId: string | null; id: string; requestId: string | null; tool: string; summary: string; ts: number }
  | { kind: 'action_done'; sessionId: string; projectId: string | null; agentId: string | null; id: string; isError: boolean; resultTokens: number; ts: number }
  | { kind: 'say'; sessionId: string; projectId: string | null; agentId: string | null; text: string; ts: number }
  | { kind: 'think'; sessionId: string; projectId: string | null; agentId: string | null; ts: number }
  | { kind: 'usage'; sessionId: string; projectId: string | null; agentId: string | null; requestId: string; model: string; input: number; output: number; cacheRead: number; cacheWrite: number; ts: number }
  | { kind: 'agent_start'; sessionId: string; projectId: string | null; agentId: string; agentType: string | null; description: string | null; model: string | null; toolUseId?: string | null; ts: number }
  | { kind: 'session'; sessionId: string; projectId: string | null; state: SessionState; title?: string | null; ts: number }
  | { kind: 'limits'; limits: unknown }
  | { kind: 'projects' }

export type SessionState = 'working' | 'waiting' | 'idle' | 'ended'

class Bus extends EventEmitter {
  publish(ev: LiveEvent) {
    this.emit('event', ev)
  }
}

export const bus = new Bus()
bus.setMaxListeners(100)
