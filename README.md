# Claude HQ

A local office floor for every Claude Code project on this machine. Each
project is an area with desks. Each open session is a senior employee at a
desk, and each subagent is a junior who comes in, gets briefed, works, reports
back and leaves. They talk as they work, take breaks when idle, and doze off
after a long quiet spell. Click an area to prompt that project.

It costs no tokens to watch: it reads Claude Code's own session logs and
settings, and gets live state from hooks that are plain shell commands. Only
the prompts you send cost anything, and they run on your plan like any other
session.

## Around the office

There is no menu bar: everything is a thing in the office, and panels only
open when you click one.

- **An area**: click it to go in and prompt that project. Click the name plate
  on its back wall for its settings, and its whiteboard for its usage. The lamp
  on the plate is green while someone works, blinks red when a session needs
  your OK, and is amber when sessions are open but idle.
- **A person**: click to read the conversation (your prompts, the replies and
  the steps in between, live) and to see what they are doing. A thought cloud
  over someone means they are thinking.
- **Drag a person to a door** (the entrance in the back wall, or any doorway)
  to send them home. That stops the session after you confirm; the
  conversation is kept. Dropping them anywhere else sends them back to work.
- **In the hub**: Reception (projects), Accounts (usage), the Archive (every
  action), and on the wall the notice board (what everything means), the clock
  and the plan meter (5 hour and weekly limits). The light switch by the
  entrance flips day and night, and the lamp over it shows whether HQ is live.
- Drag or use the arrow keys to move around; scroll or press + and - to zoom.
  Escape, scrolling out or clicking outside a room steps back out. Tab to the
  canvas's list of places if you prefer the keyboard.

## Sending prompts

The prompt box starts `claude -p` in the project's folder. "New task" starts a
fresh session; "Continue last" resumes the project's latest session that is not
busy. "Can edit" lets it edit files without asking; "Plan only" makes it plan
and change nothing. There is no option to skip permissions. Startup errors go to
`data/prompts.log`.

A session started here has no terminal, so any other step that needs your OK
(a shell command, a web fetch) is asked in HQ, with Allow and Deny. HQ passes `--permission-prompt-tool` and a small
MCP server at `/mcp/<session>` for this, so it works without the hooks. If
nobody answers within 2 minutes, or HQ is closed, the step is refused and Claude
is told why. To stop being asked for something, add an allow rule such as
`"Bash(npm test:*)"` to the project's `.claude/settings.json`.

## Clipboards

Each room has a clipboard on its back wall, left of the name plate.

- **Your list**: add items, tick them off, remove them. "Send to Claude" starts
  an item as a new task in that project. Saved in `data/hq.db`.
- **Claude's plans**: the to-do lists sessions keep while they work, read from
  the session logs, so they cost nothing. They tick off live. Each helper
  (subagent) is listed under the task that was in progress when it was sent,
  with its own to-do list if it made one, and is marked when it reports back.
  Plans from the last 3 days are shown, newest first.

## Run it

```bash
npm install
npm run dev            # server on 127.0.0.1:4317, UI on http://127.0.0.1:4318
npm test               # unit tests for the office, the people and the prompt endpoint
```

Open http://127.0.0.1:4318 in a browser on Windows. WSL forwards localhost.

## Live states

`npm run dev` and `npm start` add HQ's hooks to `~/.claude/settings.json`
before they start, so approvals, ending sessions and the budget always work.
When the hooks are already there, nothing is written.

```bash
npm run hooks:install                  # the same thing by hand
npm run hooks:install -- --statusline  # also sends fresher plan limits from the CLI status line
npm run hooks:uninstall                # takes them out again
```

With the hooks installed, a session asking for permission shows up in HQ with
Allow, Deny and "Ask in terminal". While HQ is open, the request waits there
for up to 2 minutes (`HQ_APPROVAL_WAIT` seconds, set it before installing the
hooks), then goes to the terminal as usual. With HQ closed, nothing waits.
Sessions started from HQ have no terminal, so they wait 50 seconds at most
(Claude Code gives up on the request at about a minute) and are told the step
did not run.

Your old settings file is backed up to `data/backups/` each time it changes. Hooks tell
HQ when a session is waiting for your approval and when it ends, and which
process runs each session, so sending someone home stops the right one. Run
the install again after updating HQ to pick up new hooks. Without hooks, HQ
can still stop sessions it started, and any session that is the only one
running in its folder. Everything
else (actions, replies, tokens) comes from the session logs without them.

## The 5 hour budget

With the hooks installed and HQ running, HQ watches the 5 hour limit for
every session on this machine:

- At 80%, each working session is told once to finish the step it is on,
  leave the work in a state that builds, and list what is left.
- At 85%, new steps are refused until the window resets. A session that keeps
  trying has its turn ended. Either way it is marked as paused.
- A prompt you type past the limit still runs, and that session is left alone
  until the reset.
- In the last 30 minutes before a reset, if nothing is working or waiting,
  HQ uses what is left: it resumes paused sessions to finish their task, then
  starts the prompts you queued with "Spare usage" in a project's prompt box,
  one at a time. That work may go up to 95% and 99%.

The plan meter lists what is paused and queued. Set `HQ_WRAP_AT`, `HQ_STOP_AT`
and `HQ_SPARE_MIN` to change the numbers, or `HQ_BUDGET=off` to turn it off.
Run `npm run hooks:install` again after updating, since the prompt and tool
hooks now read HQ's reply.

## Where the numbers come from

- **Plan limits**: `cachedUsageUtilization` in `~/.claude.json`, which Claude
  Code refreshes itself, plus the status line if you install it.
- **Tokens**: every API call's usage in `~/.claude/projects/**/*.jsonl`,
  counted once per request. Subagent calls are linked to the prompt that
  started them.
- **API value**: what those tokens would cost on the API, using per-model rates
  calibrated from the cost totals Claude Code writes into each session. On Pro
  this is a relative weight, not a bill.
- **Per action**: an estimate. A reply's output is split across the actions in
  it, and a tool's result counts as the input it adds.

Data lives in `data/hq.db` (SQLite). Delete it to rebuild from the logs.

## Art

Kenney's Roguelike Indoors and RPG Urban packs, CC0. See
`web/src/assets/kenney/License.txt`.
