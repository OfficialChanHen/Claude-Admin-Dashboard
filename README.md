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

- **An area**: click it to prompt that project. Click its name plate for its
  settings, and its whiteboard for its usage.
- **A person**: click to open their session.
- **Reception**: your projects. **Accounts**: usage. **Archive**: every action.
  **Clock**: plan limits. The Rooms menu opens the same places.
- Drag or use the arrow keys to move around; scroll or press + and - to zoom.

## Sending prompts

The prompt box starts `claude -p` in the project's folder. "New task" starts a
fresh session; "Continue last" resumes the project's latest session that is not
busy. "Can edit" lets it edit files without asking; "Plan only" makes it plan
and change nothing. There is no option to skip permissions. Startup errors go to
`data/prompts.log`.

## Run it

```bash
npm install
npm run dev            # server on 127.0.0.1:4317, UI on http://127.0.0.1:4318
npm test               # unit tests for the office, the people and the prompt endpoint
```

Open http://127.0.0.1:4318 in a browser on Windows. WSL forwards localhost.

## Live states (optional, recommended)

```bash
npm run hooks:install                  # adds hooks to ~/.claude/settings.json
npm run hooks:install -- --statusline  # also sends fresher plan limits from the CLI status line
npm run hooks:uninstall                # takes them out again
```

Your old settings file is backed up to `data/backups/` each time. Hooks tell
HQ when a session is waiting for your approval and when it ends. Everything
else (actions, replies, tokens) comes from the session logs without them.

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
