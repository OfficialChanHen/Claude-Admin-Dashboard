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
export const CLAUDE_CREDENTIALS = path.join(CLAUDE_DIR, '.credentials.json')

// Where to look for git repos on first run. More can be added from the app.
export const SCAN_ROOTS = (process.env.HQ_SCAN_ROOTS ?? path.join(HOME, 'Programming'))
  .split(':')
  .filter(Boolean)

// A session with no activity for this long is shown as asleep.
export const ACTIVE_WINDOW_MS = 10 * 60 * 1000

// How long a permission request waits for an answer in HQ before Claude Code
// asks in the terminal instead. scripts/install-hooks.mjs reads the same variable.
export const APPROVAL_WAIT_MS = Number(process.env.HQ_APPROVAL_WAIT ?? 120) * 1000

// Sessions HQ starts ask through its MCP prompt tool, and Claude Code drops an
// MCP request after about 60 seconds. HQ answers before that, so the session
// is told nobody answered instead of failing with a bare timeout.
export const HEADLESS_APPROVAL_WAIT_MS = Math.min(APPROVAL_WAIT_MS, 50_000)

// Managers and the boss (see hierarchy.ts). Each round is a real prompt on your
// plan, so a manager or the boss reports at most once per HQ_REPORT_MIN
// minutes, and only when something new happened. HQ_HIERARCHY=off turns them off.
export const HIERARCHY = {
  on: process.env.HQ_HIERARCHY !== 'off',
  everyMs: Number(process.env.HQ_REPORT_MIN ?? 10) * 60_000,
  // Prompts one round may send to the rank below, so a round can't start a storm.
  promptsPerRound: 2,
  // Reading a digest and writing a summary doesn't need the biggest model.
  model: process.env.HQ_ROLE_MODEL ?? 'sonnet',
  effort: process.env.HQ_ROLE_EFFORT ?? 'low',
  // Every resume re-reads the whole conversation, so after this many rounds a
  // manager or the boss starts a fresh session with only its last report.
  roundsPerSession: Number(process.env.HQ_ROLE_ROUNDS ?? 6),
}

// The 5 hour budget (see budget.ts). Sessions are asked to wrap up at
// HQ_WRAP_AT percent and kept from starting new steps at HQ_STOP_AT. In the
// last HQ_SPARE_MIN minutes before the window resets, whatever is left goes to
// paused and queued work. HQ_BUDGET=off turns all of it off.
export const BUDGET = {
  on: process.env.HQ_BUDGET !== 'off',
  wrapAt: Number(process.env.HQ_WRAP_AT ?? 80),
  stopAt: Number(process.env.HQ_STOP_AT ?? 85),
  spareMs: Number(process.env.HQ_SPARE_MIN ?? 30) * 60_000,
  spareWrapAt: 95,
  spareStopAt: 99,
}
