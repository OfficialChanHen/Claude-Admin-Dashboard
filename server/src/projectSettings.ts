import fs from 'node:fs'
import path from 'node:path'

// What Claude Code may do in a project HQ tracks without asking: auto mode, and
// commands that only read or check. They go in each project's own
// .claude/settings.local.json rather than ~/.claude/settings.json, so folders
// outside HQ keep asking as usual, and the local file stays on this machine
// instead of being committed with the project.
export const PROJECT_PERMISSIONS = {
  defaultMode: 'auto',
  allow: [
    'Bash(npx tsc *)',
    'Bash(npx eslint *)',
    'Bash(ls *)',
    'Bash(cat *)',
    'Bash(head *)',
    'Bash(tail *)',
    'Bash(wc *)',
    'Bash(pwd)',
    'Bash(echo *)',
    'Bash(which *)',
    'Bash(find *)',
    'Bash(grep *)',
    'Bash(rg *)',
    'Bash(tree *)',
    'Bash(file *)',
    'Bash(stat *)',
    'Bash(du *)',
    'Bash(df *)',
    'Bash(diff *)',
    'Bash(sort *)',
    'Bash(uniq *)',
    'Bash(jq *)',
    'Bash(date)',
    'Bash(mkdir *)',
    'Bash(git status *)',
    'Bash(git diff *)',
    'Bash(git log *)',
    'Bash(git show *)',
    'Bash(git branch *)',
    'Bash(npm test *)',
    'Bash(npm run *)',
    'Bash(npx vitest *)',
    'Read',
    'Bash(identify *)',
    'Bash(exiftool *)',
    'Bash(pngcheck *)',
    'Bash(xxd *)',
    'Bash(od *)',
    'Bash(hexdump *)',
    'Bash(strings *)',
    'Bash(base64 *)',
    'Bash(md5sum *)',
    'Bash(sha256sum *)',
    'Bash(realpath *)',
    'Bash(readlink *)',
    'Bash(basename *)',
    'Bash(dirname *)',
    'Bash(cut *)',
    'Bash(tr *)',
    'Bash(less *)',
    'Bash(column *)',
    'Bash(date *)',
    'Bash(git rev-parse *)',
    'Bash(git ls-files *)',
    'Bash(git blame *)',
    'Bash(git remote -v)',
    'Bash(git stash list *)',
    'Bash(git tag -l *)',
    'Bash(npm ls *)',
    'Bash(node --version)',
    'Bash(npm --version)',
  ],
}

type Settings = { permissions?: { defaultMode?: string; allow?: string[]; [k: string]: unknown }; [k: string]: unknown }

/**
 * Settings with HQ's permissions added. Everything already there is kept: other
 * keys, deny and ask rules, and allow rules HQ doesn't know about.
 */
export function withProjectPermissions(settings: Settings): Settings {
  const perms = settings.permissions ?? {}
  const allow = [...(perms.allow ?? [])]
  for (const rule of PROJECT_PERMISSIONS.allow) if (!allow.includes(rule)) allow.push(rule)
  return { ...settings, permissions: { ...perms, defaultMode: PROJECT_PERMISSIONS.defaultMode, allow } }
}

/**
 * Writes HQ's permissions into the project's .claude/settings.local.json. A file that
 * already has them is left alone, and one that isn't valid JSON is never
 * overwritten. Returns whether the file changed.
 */
export function writeProjectSettings(dir: string): boolean {
  const file = path.join(dir, '.claude', 'settings.local.json')
  let before = ''
  let settings: Settings = {}
  try {
    before = fs.readFileSync(file, 'utf8')
    settings = JSON.parse(before)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return false
  }
  const after = JSON.stringify(withProjectPermissions(settings), null, 2) + '\n'
  if (after === before) return false
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, after)
  return true
}
