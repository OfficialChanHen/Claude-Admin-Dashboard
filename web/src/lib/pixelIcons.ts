// Small pixel icons, 7 by 7, '#' filled. Used on the canvas and in the HUD so
// every icon matches the pixel art. No emoji or font symbols.

export const ICONS = {
  check: ['.......', '......#', '.....##', '#...##.', '##.##..', '.###...', '..#....'],
  dots: ['.......', '.......', '.......', '.#.#.#.', '.......', '.......', '.......'],
  bang: ['...#...', '..###..', '..###..', '...#...', '...#...', '.......', '...#...'],
  question: ['..###..', '.#...#.', '.....#.', '...##..', '...#...', '.......', '...#...'],
  cup: ['.#..#..', '..#..#.', '.......', '#####..', '#...###', '#...#.#', '.###.#.'],
  note: ['..#####', '..#...#', '..#...#', '..#...#', '###.###', '###.###', '.......'],
  sleep: ['.......', '.####..', '...#...', '..#....', '.####..', '.......', '.......'],
  close: ['#.....#', '.#...#.', '..#.#..', '...#...', '..#.#..', '.#...#.', '#.....#'],
  page: ['.####..', '.#..##.', '.#...#.', '.#.#.#.', '.#...#.', '.#.#.#.', '.#####.'],
  search: ['..###..', '.#...#.', '.#...#.', '.#...#.', '..####.', '.....##', '......#'],
  pencil: ['.....##', '....###', '...###.', '..###..', '.###...', '##.....', '#......'],
  terminal: ['#######', '#.....#', '#.#...#', '#..#..#', '#.#.###', '#.....#', '#######'],
  globe: ['.#####.', '#..#..#', '#######', '#..#..#', '#######', '#..#..#', '.#####.'],
  person: ['..###..', '..###..', '...#...', '.#####.', '...#...', '..#.#..', '.#...#.'],
  board: ['#######', '#.....#', '#.##..#', '#.....#', '#.###.#', '#######', '..#.#..'],
  quote: ['##.##..', '##.##..', '.#..#..', '#..#...', '.......', '.......', '.......'],
  arrow: ['.......', '...#...', '....#..', '######.', '....#..', '...#...', '.......'],
  dot: ['.......', '..###..', '.#####.', '.#####.', '.#####.', '..###..', '.......'],
  bulb: ['..###..', '.#####.', '.#####.', '.#####.', '..###..', '..###..', '...#...'],
  door: ['.#####.', '.#...#.', '.#...#.', '.#..##.', '.#...#.', '.#...#.', '#######'],
} as const

export type IconName = keyof typeof ICONS

/** The filled cells of an icon, for drawing as rectangles. */
export function iconCells(name: IconName): [number, number][] {
  const out: [number, number][] = []
  ICONS[name].forEach((row, y) => [...row].forEach((ch, x) => ch === '#' && out.push([x, y])))
  return out
}

const TOOL_ICON: Record<string, IconName> = {
  Read: 'page', NotebookRead: 'page', Grep: 'search', Glob: 'search', LS: 'search',
  Edit: 'pencil', Write: 'pencil', MultiEdit: 'pencil', NotebookEdit: 'pencil',
  Bash: 'terminal', BashOutput: 'terminal', KillShell: 'terminal', Monitor: 'terminal',
  WebSearch: 'globe', WebFetch: 'globe',
  Agent: 'person', Task: 'person', SendMessage: 'person', SubagentHandback: 'person',
  TodoWrite: 'board', Skill: 'board', ToolSearch: 'board', AskUserQuestion: 'question',
}

export function toolIcon(tool: string): IconName {
  if (tool.startsWith('mcp__')) return 'globe'
  return TOOL_ICON[tool] ?? 'dot'
}
