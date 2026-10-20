#!/usr/bin/env node
// Adds (or with --uninstall removes) the Claude Code hooks that tell HQ what
// your sessions are doing. Hooks are shell commands run by Claude Code, so they
// cost no tokens. If HQ is not running, curl fails in a few ms and nothing happens.
//
//   npm run hooks:install              hooks only
//   npm run hooks:install -- --statusline   also route the status line through HQ
//   npm run hooks:uninstall
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
const port = process.env.HQ_PORT ?? 4317
const MARK = `127.0.0.1:${port}/api/hook`
const STATUS_MARK = 'claude-hq-statusline'
const EVENTS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Notification', 'Stop', 'SubagentStop']
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PermissionRequest'])

const command = `curl -s -m 1 -o /dev/null -X POST -H 'content-type: application/json' --data-binary @- http://${MARK} || true`

const uninstall = process.argv.includes('--uninstall')
const withStatus = process.argv.includes('--statusline')

const raw = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, 'utf8') : '{}'
const settings = JSON.parse(raw)

const backupDir = path.join(root, 'data', 'backups')
fs.mkdirSync(backupDir, { recursive: true })
const backup = path.join(backupDir, `settings.${Date.now()}.json`)
fs.writeFileSync(backup, raw)

const hooks = settings.hooks ?? {}
for (const ev of Object.keys(hooks)) {
  hooks[ev] = hooks[ev]
    .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !String(h.command ?? '').includes(MARK)) }))
    .filter((g) => g.hooks.length)
  if (!hooks[ev].length) delete hooks[ev]
}
if (!uninstall) {
  for (const ev of EVENTS) {
    const group = { hooks: [{ type: 'command', command, timeout: 2 }] }
    if (TOOL_EVENTS.has(ev)) group.matcher = '*'
    ;(hooks[ev] ??= []).push(group)
  }
}
if (Object.keys(hooks).length) settings.hooks = hooks
else delete settings.hooks

const ownsStatus = String(settings.statusLine?.command ?? '').includes(STATUS_MARK)
if (uninstall && ownsStatus) delete settings.statusLine
if (!uninstall && withStatus) {
  if (settings.statusLine && !ownsStatus) {
    console.log('You already have a status line, so it was left alone.')
  } else {
    settings.statusLine = { type: 'command', command: `node "${path.join(root, 'scripts', 'statusline.mjs')}" # ${STATUS_MARK}` }
  }
}

fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')
console.log(`${uninstall ? 'Removed' : 'Installed'} HQ hooks in ${settingsPath}`)
console.log(`Backup of the old file: ${backup}`)
