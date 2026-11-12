/**
 * The question in a /btw side question, or null for a normal prompt.
 * "/btw" alone is a side question with nothing asked yet.
 */
export function btwQuestion(text: string): string | null {
  const m = /^\/btw(?:\s+([\s\S]*))?$/i.exec(text.trim())
  return m ? (m[1] ?? '').trim() : null
}
