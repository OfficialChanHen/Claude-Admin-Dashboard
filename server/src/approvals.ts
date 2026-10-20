import { randomUUID } from 'node:crypto'

// Permission requests you can answer from HQ. The PermissionRequest hook posts
// here and waits for the reply; Claude Code reads the decision from the hook's
// output. With no answer (nobody has HQ open, you send it to the terminal, or
// it times out) the hook prints nothing useful and Claude Code asks in the
// terminal as usual. HQ never decides on its own.
//
// Sessions HQ starts itself run headless, with no terminal to fall back on.
// Their requests come through the permission prompt tool (see mcp.ts) and are
// marked headless; with no answer, the step is refused.

export type Approval = {
  id: string
  sessionId: string
  projectId: string | null
  tool: string
  summary: string
  detail: string
  ts: number
  expiresAt: number
  /** Started from HQ, so there is no terminal to hand it back to. */
  headless?: boolean
}
export type Decision = 'allow' | 'deny'
export type ApprovalEvent = { kind: 'approval'; approval: Approval } | { kind: 'approval_done'; id: string; decision: Decision | null }

type Pending = { a: Approval; resolve: (d: Decision | null) => void; timer: ReturnType<typeof setTimeout> }

export class Approvals {
  /** Open HQ windows. Requests are only held while someone can see them. */
  viewers = 0
  private pending = new Map<string, Pending>()

  constructor(private publish: (ev: ApprovalEvent) => void, private waitMs: number) {}

  ask(req: Omit<Approval, 'id' | 'ts' | 'expiresAt'>, now = Date.now()): { id: string | null; decision: Promise<Decision | null> } {
    if (this.viewers <= 0) return { id: null, decision: Promise.resolve(null) }
    const a: Approval = { ...req, id: randomUUID(), ts: now, expiresAt: now + this.waitMs }
    const decision = new Promise<Decision | null>((resolve) => {
      const timer = setTimeout(() => this.decide(a.id, null), this.waitMs)
      this.pending.set(a.id, { a, resolve, timer })
    })
    this.publish({ kind: 'approval', approval: a })
    return { id: a.id, decision }
  }

  /** Answers a request. null hands it back to the terminal. */
  decide(id: string, decision: Decision | null) {
    const p = this.pending.get(id)
    if (!p) return false
    clearTimeout(p.timer)
    this.pending.delete(id)
    p.resolve(decision)
    this.publish({ kind: 'approval_done', id, decision })
    return true
  }

  /** The session moved on without us (the hook was cancelled or the session ended). */
  dropSession(sessionId: string) {
    for (const p of [...this.pending.values()]) if (p.a.sessionId === sessionId) this.decide(p.a.id, null)
  }

  list() {
    return [...this.pending.values()].map((p) => p.a)
  }
}

/** What the hook prints for Claude Code. An empty object means "ask as usual". */
export function hookReply(decision: Decision | null) {
  if (!decision) return {}
  return {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: decision === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: 'Denied from Claude HQ.' },
    },
  }
}

/** What the permission prompt tool tells a headless session. */
export type PromptAnswer = { behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string }

/** `held` is false when nobody had HQ open, so nobody saw the request. */
export function promptAnswer(decision: Decision | null, input: Record<string, unknown>, held: boolean): PromptAnswer {
  if (decision === 'allow') return { behavior: 'allow', updatedInput: input }
  if (decision === 'deny') return { behavior: 'deny', message: 'The user denied this step in Claude HQ.' }
  return {
    behavior: 'deny',
    message: held
      ? 'Nobody answered in Claude HQ in time, so this step did not run.'
      : 'Claude HQ is not open, so nobody could approve this step. It did not run.',
  }
}

/** The full thing being asked for, so you can read it before you say yes. */
export function describeInput(tool: string, input: Record<string, unknown> = {}) {
  const s = (v: unknown) => (typeof v === 'string' ? v : '')
  let out: string
  switch (tool) {
    case 'Bash':
      out = s(input.command)
      break
    case 'Write':
      out = `${s(input.file_path)}\n\n${s(input.content)}`
      break
    case 'Edit':
      out = `${s(input.file_path)}\n\n- ${s(input.old_string)}\n+ ${s(input.new_string)}`
      break
    case 'WebFetch':
      out = s(input.url)
      break
    default:
      out = JSON.stringify(input, null, 2)
  }
  return out.length > 2000 ? out.slice(0, 1997) + '...' : out
}
