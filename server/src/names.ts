// Readable names for sessions and helpers, so the office, the reports and the
// panels say what someone is working on rather than "Untitled" or a session id.
// Claude Code titles its interactive sessions itself; the ones HQ starts with
// `claude -p` get none, so they are named after their first prompt. Plain text
// work, no model call, so it costs nothing.

const MAX = 48

// How people start a request, which says nothing about the task.
const OPENERS = /^(?:(?:hey|hi|hello|ok|okay|so|right|now|also|and|then)\b[\s,!.]*|please\s+|(?:can|could|would|will) you(?: please)?\s+|i(?:'d| would) like (?:you )?to\s+|i want (?:you )?to\s+|i need (?:you )?to\s+|let'?s\s+|go ahead and\s+|help me\s+)+/i

/** A short name for a session, from the first thing it was asked. Null when there is nothing to go on. */
export function taskTitle(prompt: string): string | null {
  let t = prompt
    // HQ's own headers on a prompt, and pasted or tagged blocks.
    .replace(/^\s*\[[^\]\n]*\]\s*/, '')
    .replace(/<([a-z_-]+)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
  // The first line with words on it, and its first sentence.
  t = t.split('\n').map((l) => l.replace(/^\s*(?:[-*+>#]+|\d+[.)])\s*/, '').trim()).find((l) => /[a-z]{2}/i.test(l)) ?? ''
  t = t.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim()
  t = t.split(/(?<=[a-z0-9)][.!?])\s+(?=[A-Z])/)[0]
  t = t.replace(OPENERS, '').replace(/[\s.!?:;,]+$/, '').trim()
  if (!/[a-z]{2}/i.test(t)) return null
  t = t[0].toUpperCase() + t.slice(1)
  if (t.length <= MAX) return t
  const cut = t.slice(0, MAX)
  const space = cut.lastIndexOf(' ')
  return (space > MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s.,;:/-]+$/, '') + '…'
}

const HELPER_KINDS: Record<string, string> = {
  'general-purpose': 'Helper',
  Explore: 'Explorer',
  Plan: 'Planner',
  'statusline-setup': 'Status line helper',
}

/** What to call a helper (subagent): its task, or else what kind of helper it is. */
export function helperName(description: string | null | undefined, agentType: string | null | undefined) {
  const d = description?.trim()
  if (d) return d
  if (!agentType) return 'Helper'
  return HELPER_KINDS[agentType] ?? agentType.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

/**
 * Puts names in place of session ids in a report. Managers used to write
 * "Untitled (04bd3ece)"; this reads "Make reports easier to read" instead.
 * `names` maps full session ids to their names.
 */
export function nameSessions(text: string, names: Map<string, string>) {
  if (!names.size) return text
  const byShort = new Map<string, string>()
  for (const [id, name] of names) byShort.set(id.slice(0, 8).toLowerCase(), name)
  const find = (id: string) => byShort.get(id.slice(0, 8).toLowerCase())
  const ID = '([0-9a-f]{8}(?:-[0-9a-f]{4}){0,3}(?:-[0-9a-f]{12})?)'
  return text
    // "Untitled (04bd3ece)", "Untitled session (04bd3ece…)", "Agent "x" (session 04bd3ece)"
    .replace(new RegExp(`(?:Untitled(?: session)?|Agent "[^"\\n]*")\\s*\\((?:session\\s+)?${ID}[^)]*\\)`, 'gi'), (m, id) => {
      const n = find(id)
      return n ? `"${n}"` : m
    })
    // "(session 04bd3ece)" after a name that is already there.
    .replace(new RegExp(`\\s*\\(session(?: id)?\\s+${ID}\\)`, 'gi'), (m, id) => (find(id) ? '' : m))
    // A bare id.
    .replace(new RegExp(`\\b${ID}\\b`, 'gi'), (m, id) => {
      const n = find(id)
      return n ? `"${n}"` : m
    })
    .replace(/""([^"\n]+)""/g, '"$1"')
}
