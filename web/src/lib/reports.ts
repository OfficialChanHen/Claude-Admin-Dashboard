// Reports from the managers and the boss are markdown. Anything that needs you
// is lifted out and shown first, so it isn't buried in the middle of a list.

const NEEDS_YOU = /^\s*(?:[-*+]\s+)?\*\*\s*Needs you:?\s*\*\*:?\s*/i

export function splitReport(text: string): { needsYou: string[]; body: string } {
  const needsYou: string[] = []
  const body: string[] = []
  for (const line of text.split('\n')) {
    if (NEEDS_YOU.test(line)) {
      const rest = line.replace(NEEDS_YOU, '').trim()
      if (rest) needsYou.push(rest)
    } else body.push(line)
  }
  return { needsYou, body: body.join('\n').trim() }
}

/** The first sentence of a report, for the list of earlier ones. */
export function headline(text: string, max = 110) {
  const first = text.split('\n').map((l) => l.replace(/^\s*[-*+]\s+/, '').replace(/\*\*/g, '').trim()).find(Boolean) ?? ''
  const sentence = first.split(/(?<=[.!?])\s/)[0]
  return sentence.length > max ? sentence.slice(0, max - 1).trimEnd() + '…' : sentence
}
