import type { IconName } from '../lib/pixelIcons'

// What each tool means in the office: the kind of work, the object it is done
// at, and the words and icon shown over the person doing it. The legend, the
// tooltips and the chips over people all read from here so they agree.

export type Station = 'desk' | 'board' | 'cabinet'
export type TaskKind = 'read' | 'search' | 'edit' | 'run' | 'web' | 'plan' | 'delegate' | 'ask' | 'other'

export const TASKS: Record<TaskKind, { verb: string; icon: IconName; station: Station }> = {
  read: { verb: 'Reading', icon: 'page', station: 'cabinet' },
  search: { verb: 'Searching', icon: 'search', station: 'cabinet' },
  edit: { verb: 'Editing', icon: 'pencil', station: 'desk' },
  run: { verb: 'Running', icon: 'terminal', station: 'desk' },
  web: { verb: 'Browsing', icon: 'globe', station: 'desk' },
  plan: { verb: 'Planning', icon: 'board', station: 'board' },
  delegate: { verb: 'Handing off', icon: 'person', station: 'desk' },
  ask: { verb: 'Asking you', icon: 'question', station: 'board' },
  other: { verb: 'Using', icon: 'dot', station: 'desk' },
}

const KIND: Record<string, TaskKind> = {
  Read: 'read', NotebookRead: 'read',
  Grep: 'search', Glob: 'search', LS: 'search',
  Edit: 'edit', Write: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit',
  Bash: 'run', BashOutput: 'run', KillShell: 'run', Monitor: 'run',
  WebSearch: 'web', WebFetch: 'web',
  TodoWrite: 'plan', Skill: 'plan', ToolSearch: 'plan', EnterPlanMode: 'plan', ExitPlanMode: 'plan',
  Agent: 'delegate', Task: 'delegate', SendMessage: 'delegate',
  AskUserQuestion: 'ask',
}

export function taskOf(tool: string): TaskKind {
  return KIND[tool] ?? 'other'
}

/** A tool's own name, without the MCP server prefix. */
export function shortTool(tool: string) {
  return tool.startsWith('mcp__') ? tool.split('__').pop()! : tool
}

// Some tools read better with their own words.
const VERB: Record<string, string> = {
  Write: 'Writing', Glob: 'Finding', WebSearch: 'Looking up', WebFetch: 'Opening', Skill: 'Using skill',
}
const FIXED: Record<string, string> = {
  TodoWrite: 'Updating the to-do list', ToolSearch: 'Finding tools', EnterPlanMode: 'Planning', ExitPlanMode: 'Sharing the plan',
  BashOutput: 'Checking a command', KillShell: 'Stopping a command',
  // The senior says the task out loud, and the call stays open while the helper works.
  Agent: 'Working with a helper', Task: 'Working with a helper', SendMessage: 'Messaging a helper',
}

/** What a person is doing, in a few words: "Reading auth.ts", "Running npm test". */
export function taskLabel(tool: string, summary: string, max = 30) {
  if (FIXED[tool]) return FIXED[tool]
  const kind = taskOf(tool)
  if (kind === 'other') return `Using ${shortTool(tool)}`
  if (kind === 'ask') return TASKS.ask.verb
  let target = summary.replace(/\s+/g, ' ').trim()
  // Files are named by their last part; the folder rarely fits.
  if (kind === 'read' || kind === 'edit') target = target.split('/').pop() ?? target
  const verb = VERB[tool] ?? TASKS[kind].verb
  // A command's description already says what it does ("Run the tests"); a bare command does not.
  const described = kind === 'run' && /^[A-Z]/.test(target)
  const text = described ? target : target ? `${verb} ${target}` : verb
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/** Things on the floor and what happens at them, for tooltips and the key. */
export type Thing = 'desk' | 'cabinet' | 'board' | 'coffee' | 'vending' | 'table' | 'sofa' | 'hotdesk'
export const THINGS: Record<Thing, { name: string; does: string; icon: IconName }> = {
  desk: { name: 'Desk', does: 'editing files, running commands and browsing', icon: 'pencil' },
  cabinet: { name: 'Filing cabinets', does: 'reading and searching files', icon: 'page' },
  board: { name: 'Whiteboard', does: 'planning, to-do lists and questions for you', icon: 'board' },
  coffee: { name: 'Coffee counter', does: 'a break between tasks', icon: 'cup' },
  vending: { name: 'Vending machine', does: 'a break between tasks', icon: 'cup' },
  table: { name: 'Table', does: 'a break, or a spare seat when the desks are full', icon: 'cup' },
  hotdesk: { name: 'Hot desks', does: 'a spare desk for anyone whose room is full', icon: 'pencil' },
  sofa: { name: 'Sofa', does: 'a break between tasks', icon: 'cup' },
}
