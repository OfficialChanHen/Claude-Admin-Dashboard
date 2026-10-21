// Claude's replies are markdown. The chat shows them formatted rather than as
// raw asterisks and pipes. This covers what replies actually use (headings,
// lists, tables, code, bold, links) and is drawn in the browser, so it costs
// no tokens. Output is data for React, never HTML.

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; children: Inline[] }
  | { kind: 'italic'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; children: Inline[] }

export type Block =
  | { kind: 'heading'; level: number; inline: Inline[] }
  | { kind: 'para'; inline: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'code'; text: string }
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { kind: 'rule' }

const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

const cells = (line: string) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => inline(c.trim()))

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: Block[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) out.push({ kind: 'para', inline: inline(para.join('\n')) })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*```/.test(line)) {
      flush()
      const code: string[] = []
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i])
      out.push({ kind: 'code', text: code.join('\n') })
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      flush()
      out.push({ kind: 'heading', level: h[1].length, inline: inline(h[2]) })
      continue
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush()
      out.push({ kind: 'rule' })
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      flush()
      const head = cells(line)
      const rows: Inline[][][] = []
      i++
      while (i + 1 < lines.length && lines[i + 1].includes('|') && lines[i + 1].trim()) rows.push(cells(lines[++i]))
      out.push({ kind: 'table', head, rows })
      continue
    }
    const li = LIST_ITEM.exec(line)
    if (li) {
      flush()
      const ordered = /\d/.test(li[1])
      const items: string[] = [li[2]]
      // Further items, and indented lines that carry on the last one.
      while (i + 1 < lines.length) {
        const next = LIST_ITEM.exec(lines[i + 1])
        if (next && /\d/.test(next[1]) === ordered) items.push(next[2])
        else if (/^\s{2,}\S/.test(lines[i + 1]) && !next) items[items.length - 1] += ' ' + lines[i + 1].trim()
        else break
        i++
      }
      out.push({ kind: 'list', ordered, items: items.map(inline) })
      continue
    }
    if (!line.trim()) flush()
    else para.push(line)
  }
  flush()
  return out
}

/** Bold, italic, inline code and links inside one block. */
export function inline(src: string): Inline[] {
  const out: Inline[] = []
  let text = ''
  const push = (n: Inline) => {
    if (text) out.push({ kind: 'text', text })
    text = ''
    out.push(n)
  }
  let i = 0
  while (i < src.length) {
    const rest = src.slice(i)
    let m: RegExpExecArray | null
    if ((m = /^`([^`]+)`/.exec(rest))) push({ kind: 'code', text: m[1] })
    else if ((m = /^\*\*(.+?)\*\*/s.exec(rest)) || (m = /^__(.+?)__/s.exec(rest))) push({ kind: 'bold', children: inline(m[1]) })
    else if ((m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest))) push({ kind: 'link', href: m[2], children: inline(m[1]) })
    else if ((m = /^\*(?!\s)([^*]+?)\*/.exec(rest)) || (m = /^_(?!\s)([^_]+?)_(?![A-Za-z0-9])/.exec(rest))) {
      // A lone _ inside a word (snake_case) is not italic.
      if (rest[0] === '_' && /[A-Za-z0-9]/.test(src[i - 1] ?? '')) m = null
      if (m) push({ kind: 'italic', children: inline(m[1]) })
    }
    if (m) {
      i += m[0].length
    } else {
      text += src[i]
      i++
    }
  }
  if (text) out.push({ kind: 'text', text })
  return out
}

/** Only web links open; file paths in replies are shown as text. */
export function safeHref(href: string) {
  return /^https?:\/\//i.test(href) ? href : null
}
