import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export const ROOT = path.resolve(here, '../..')
export const HOME = os.homedir()
export const PORT = Number(process.env.HQ_PORT ?? 4317)
// Loopback only: this server can start agents that run shell commands.
export const HOST = '127.0.0.1'

export const DATA_DIR = path.join(ROOT, 'data')
export const DB_PATH = path.join(DATA_DIR, 'hq.db')
export const WEB_DIST = path.join(ROOT, 'web', 'dist')

export const CLAUDE_DIR = path.join(HOME, '.claude')
export const TRANSCRIPTS_DIR = path.join(CLAUDE_DIR, 'projects')
export const CLAUDE_STATE = path.join(HOME, '.claude.json')

// Where to look for git repos on first run. More can be added from the app.
export const SCAN_ROOTS = (process.env.HQ_SCAN_ROOTS ?? path.join(HOME, 'Programming'))
  .split(':')
  .filter(Boolean)

// A session with no activity for this long is shown as asleep.
export const ACTIVE_WINDOW_MS = 10 * 60 * 1000
