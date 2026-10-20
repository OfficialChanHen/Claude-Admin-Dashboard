import { describe, expect, it } from 'vitest'
import { toolIcon } from '../lib/pixelIcons'
import { TASKS, shortTool, taskLabel, taskOf } from './tasks'

describe('taskOf', () => {
  it.each([
    ['Read', 'read'], ['Grep', 'search'], ['Glob', 'search'], ['Edit', 'edit'], ['Write', 'edit'], ['Bash', 'run'],
    ['WebFetch', 'web'], ['TodoWrite', 'plan'], ['Skill', 'plan'], ['Agent', 'delegate'], ['AskUserQuestion', 'ask'],
    ['mcp__slack__post', 'other'], ['SomethingNew', 'other'],
  ])('%s is %s work', (tool, kind) => {
    expect(taskOf(tool)).toBe(kind)
  })

  it('uses the same icon as the action log for each tool', () => {
    for (const tool of ['Read', 'Grep', 'Edit', 'Bash', 'WebSearch', 'Agent', 'TodoWrite', 'AskUserQuestion']) {
      expect(TASKS[taskOf(tool)].icon).toBe(toolIcon(tool))
    }
  })
})

describe('taskLabel', () => {
  it('says what is being worked on', () => {
    expect(taskLabel('Read', 'src/auth/login.ts')).toBe('Reading login.ts')
    expect(taskLabel('Edit', 'web/src/App.tsx')).toBe('Editing App.tsx')
    expect(taskLabel('Write', 'notes.md')).toBe('Writing notes.md')
    expect(taskLabel('Bash', 'npm test')).toBe('Running npm test')
    expect(taskLabel('Bash', 'Run the tests')).toBe('Run the tests') // its description says it already
    expect(taskLabel('Grep', 'TODO')).toBe('Searching TODO')
    expect(taskLabel('WebFetch', 'github.com')).toBe('Opening github.com')
  })

  it('has its own words for tools whose summary says little', () => {
    expect(taskLabel('TodoWrite', 'Updated the to-do list')).toBe('Updating the to-do list')
    expect(taskLabel('AskUserQuestion', 'Which one?')).toBe('Asking you')
    expect(taskLabel('Agent', 'Find where login fails')).toBe('Working with a helper')
    expect(taskLabel('mcp__github__create_issue', 'whatever')).toBe('Using create_issue')
  })

  it('falls back to the verb alone, and stays short', () => {
    expect(taskLabel('Read', '')).toBe('Reading')
    const long = taskLabel('Bash', 'npm run build && npm run test -- --coverage --reporter verbose')
    expect(long.length).toBeLessThanOrEqual(30)
    expect(long.endsWith('…')).toBe(true)
    expect(taskLabel('Bash', 'a\n  b')).toBe('Running a b')
  })
})

describe('shortTool', () => {
  it('drops the MCP server prefix', () => {
    expect(shortTool('mcp__claude_ai_Gmail__send')).toBe('send')
    expect(shortTool('Read')).toBe('Read')
  })
})
