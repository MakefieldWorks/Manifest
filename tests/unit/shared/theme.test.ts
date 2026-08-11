import { describe, expect, it } from 'vitest'
import {
  BUILT_IN_THEMES,
  DEFAULT_APPEARANCE_PREFERENCE,
  THEME_TOKEN_NAMES,
  isThemeDefinition,
  normalizeAppearancePreference,
  resolveTheme,
} from '../../../src/shared/theme'

describe('theme definitions', () => {
  it('ships complete, validated light and dark token sets', () => {
    expect(BUILT_IN_THEMES.map(theme => theme.id)).toEqual([
      'manifest-light',
      'manifest-dark',
    ])

    for (const theme of BUILT_IN_THEMES) {
      expect(isThemeDefinition(theme)).toBe(true)
      expect(Object.keys(theme.tokens).sort()).toEqual([...THEME_TOKEN_NAMES].sort())
    }
  })

  it('resolves independently selected light and dark theme IDs', () => {
    expect(resolveTheme(DEFAULT_APPEARANCE_PREFERENCE, 'light').id).toBe('manifest-light')
    expect(resolveTheme(DEFAULT_APPEARANCE_PREFERENCE, 'dark').id).toBe('manifest-dark')
    expect(resolveTheme({
      ...DEFAULT_APPEARANCE_PREFERENCE,
      mode: 'light',
    }, 'dark').id).toBe('manifest-light')
    expect(resolveTheme({
      ...DEFAULT_APPEARANCE_PREFERENCE,
      mode: 'dark',
    }, 'light').id).toBe('manifest-dark')
  })

  it('falls back safely when a stored appearance is incomplete or unknown', () => {
    expect(normalizeAppearancePreference({
      mode: 'dark',
      lightThemeId: 'unknown',
      darkThemeId: 'unknown',
    })).toEqual({
      mode: 'dark',
      lightThemeId: 'manifest-light',
      darkThemeId: 'manifest-dark',
    })
  })
})
