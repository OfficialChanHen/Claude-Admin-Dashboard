import { describe, expect, it } from 'vitest'
import { inline, parseMarkdown, safeHref } from './markdown'

describe('parseMarkdown', () => {
  it('splits headings, paragraphs and rules', () => {
    expect(parseMarkdown('## Done\n\nIt works.\nReally.\n\n---')).toEqual([
      { kind: 'heading', level: 2, inline: [{ kind: 'text', text: 'Done' }] },
      { kind: 'para', inline: [{ kind: 'text', text: 'It works.\nReally.' }] },
      { kind: 'rule' },
    ])
  })

  it('reads bullet and numbered lists, with wrapped lines', () => {
    const [a, b] = parseMarkdown('- one\n- two\n  more\n\n1. first\n2. second')
    expect(a).toMatchObject({ kind: 'list', ordered: false, items: [[{ text: 'one' }], [{ text: 'two more' }]] })
    expect(b).toMatchObject({ kind: 'list', ordered: true, items: [[{ text: 'first' }], [{ text: 'second' }]] })
  })

  it('keeps code blocks as they are', () => {
    expect(parseMarkdown('```bash\nnpm run dev  # **not bold**\n```')).toEqual([{ kind: 'code', text: 'npm run dev  # **not bold**' }])
  })

  it('reads a table', () => {
    const [t] = parseMarkdown('| A | B |\n|---|:-:|\n| 1 | **2** |\n\nafter')
    expect(t).toMatchObject({ kind: 'table', head: [[{ text: 'A' }], [{ text: 'B' }]], rows: [[[{ text: '1' }], [{ kind: 'bold' }]]] })
  })
})

describe('inline', () => {
  it('finds bold, italic, code and links', () => {
    expect(inline('**Fixed** the `camera` in [camera.ts](web/src/camera.ts), *mostly*')).toEqual([
      { kind: 'bold', children: [{ kind: 'text', text: 'Fixed' }] },
      { kind: 'text', text: ' the ' },
      { kind: 'code', text: 'camera' },
      { kind: 'text', text: ' in ' },
      { kind: 'link', href: 'web/src/camera.ts', children: [{ kind: 'text', text: 'camera.ts' }] },
      { kind: 'text', text: ', ' },
      { kind: 'italic', children: [{ kind: 'text', text: 'mostly' }] },
    ])
  })

  it('leaves snake_case and lone stars alone', () => {
    expect(inline('APPROVAL_WAIT_MS is 2 * 3')).toEqual([{ kind: 'text', text: 'APPROVAL_WAIT_MS is 2 * 3' }])
  })
})

describe('safeHref', () => {
  it('opens web links only', () => {
    expect(safeHref('https://claude.com')).toBe('https://claude.com')
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('web/src/App.tsx')).toBeNull()
  })
})
