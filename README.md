# Claude HQ

A local control room for every Claude Code project on this machine. It watches
what your sessions do and shows plan limits and token usage. It costs no tokens
to run: it reads Claude Code's own session logs and settings, and gets live
state from hooks that are plain shell commands.

## Run it

```bash
npm install
npm run dev            # server on 127.0.0.1:4317, UI on http://127.0.0.1:4318
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
