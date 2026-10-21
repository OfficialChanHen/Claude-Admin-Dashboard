import { Fragment, useMemo, type ReactNode } from 'react'
import { parseMarkdown, safeHref, type Block, type Inline } from '../lib/markdown'

function inlines(nodes: Inline[]): ReactNode {
  return nodes.map((n, i) => {
    switch (n.kind) {
      case 'text':
        return <Fragment key={i}>{n.text}</Fragment>
      case 'bold':
        return <strong key={i}>{inlines(n.children)}</strong>
      case 'italic':
        return <em key={i}>{inlines(n.children)}</em>
      case 'code':
        return <code key={i}>{n.text}</code>
      case 'link': {
        const href = safeHref(n.href)
        return href ? (
          <a key={i} href={href} target="_blank" rel="noreferrer">{inlines(n.children)}</a>
        ) : (
          <span key={i} className="md-path" title={n.href}>{inlines(n.children)}</span>
        )
      }
    }
  })
}

function block(b: Block, i: number): ReactNode {
  switch (b.kind) {
    case 'heading':
      return <p key={i} className="md-h">{inlines(b.inline)}</p>
    case 'para':
      return <p key={i}>{inlines(b.inline)}</p>
    case 'list': {
      const List = b.ordered ? 'ol' : 'ul'
      return <List key={i}>{b.items.map((it, j) => <li key={j}>{inlines(it)}</li>)}</List>
    }
    case 'code':
      return <pre key={i}><code>{b.text}</code></pre>
    case 'table':
      return (
        <div key={i} className="md-table">
          <table>
            <thead><tr>{b.head.map((c, j) => <th key={j}>{inlines(c)}</th>)}</tr></thead>
            <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{inlines(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )
    case 'rule':
      return <hr key={i} />
  }
}

/** A reply from Claude, formatted. */
export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text])
  return <>{blocks.map(block)}</>
}
