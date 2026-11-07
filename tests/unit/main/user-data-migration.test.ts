import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { migratePreviousUserData } from '../../../src/main/user-data-migration'

let appData: string

beforeEach(() => { appData = mkdtempSync(join(tmpdir(), 'layertrail-appdata-')) })
afterEach(() => { rmSync(appData, { recursive: true, force: true }) })

function writePrevious(file: string, contents: string): void {
  mkdirSync(join(appData, 'Manifest'), { recursive: true })
  writeFileSync(join(appData, 'Manifest', file), contents)
}

describe('migratePreviousUserData', () => {
  it('copies recent projects and settings from the Manifest folder', () => {
    writePrevious('recent-projects.json', '["recent"]')
    writePrevious('app-settings.json', '{"theme":"dark"}')
    writePrevious('unrelated.json', '{}')
    const userData = join(appData, 'Layertrail')

    expect(migratePreviousUserData(userData, appData)).toEqual(['recent-projects.json', 'app-settings.json'])
    expect(readFileSync(join(userData, 'recent-projects.json'), 'utf8')).toBe('["recent"]')
    expect(readFileSync(join(userData, 'app-settings.json'), 'utf8')).toBe('{"theme":"dark"}')
    expect(existsSync(join(userData, 'unrelated.json'))).toBe(false)
  })

  it('never overwrites files the renamed app already has', () => {
    writePrevious('app-settings.json', '{"theme":"dark"}')
    const userData = join(appData, 'Layertrail')
    mkdirSync(userData)
    writeFileSync(join(userData, 'app-settings.json'), '{"theme":"light"}')

    expect(migratePreviousUserData(userData, appData)).toEqual([])
    expect(readFileSync(join(userData, 'app-settings.json'), 'utf8')).toBe('{"theme":"light"}')
  })

  it('does nothing for a custom user data folder', () => {
    writePrevious('app-settings.json', '{"theme":"dark"}')
    const custom = join(appData, 'elsewhere', 'profile')

    expect(migratePreviousUserData(custom, appData)).toEqual([])
    expect(existsSync(custom)).toBe(false)
  })

  it('does nothing when there is no Manifest folder', () => {
    expect(migratePreviousUserData(join(appData, 'Layertrail'), appData)).toEqual([])
  })
})
