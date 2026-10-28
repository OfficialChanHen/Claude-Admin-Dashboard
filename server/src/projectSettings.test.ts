import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PROJECT_PERMISSIONS, withProjectPermissions, writeProjectSettings } from './projectSettings.js'

describe('withProjectPermissions', () => {
  it('adds auto mode and the allow list to empty settings', () => {
    expect(withProjectPermissions({})).toEqual({ permissions: PROJECT_PERMISSIONS })
  })

  it('keeps what the project already had', () => {
    const out = withProjectPermissions({ model: 'sonnet', permissions: { allow: ['Bash(make *)', 'Read'], deny: ['Bash(rm *)'] } })
    expect(out.model).toBe('sonnet')
    expect(out.permissions!.deny).toEqual(['Bash(rm *)'])
    expect(out.permissions!.allow!.slice(0, 2)).toEqual(['Bash(make *)', 'Read'])
    expect(out.permissions!.allow!.filter((r) => r === 'Read')).toHaveLength(1)
    expect(out.permissions!.defaultMode).toBe('auto')
  })
})

describe('writeProjectSettings', () => {
  const dirs: string[] = []
  const tmp = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-settings-'))
    dirs.push(d)
    return d
  }
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
  })

  it('writes the file once, then leaves it alone', () => {
    const dir = tmp()
    expect(writeProjectSettings(dir)).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.local.json'), 'utf8'))).toEqual({ permissions: PROJECT_PERMISSIONS })
    expect(writeProjectSettings(dir)).toBe(false)
  })

  it('never overwrites a settings file it cannot read', () => {
    const dir = tmp()
    fs.mkdirSync(path.join(dir, '.claude'))
    fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), '{ broken')
    expect(writeProjectSettings(dir)).toBe(false)
    expect(fs.readFileSync(path.join(dir, '.claude', 'settings.local.json'), 'utf8')).toBe('{ broken')
  })
})
