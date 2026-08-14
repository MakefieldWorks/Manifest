import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import postcss, { type Container, type Root } from 'postcss'
import {
  BUILT_IN_THEMES,
  DEFAULT_APPEARANCE_PREFERENCE,
  THEME_TOKEN_NAMES,
  isThemeDefinition,
  normalizeAppearancePreference,
  resolveTheme,
  themesForScheme,
} from '../../../src/shared/theme'

describe('theme definitions', () => {
  it('ships complete, validated light and dark token sets', () => {
    expect(BUILT_IN_THEMES.map(theme => theme.id)).toEqual([
      'manifest-light',
      'manifest-graphite-light',
      'manifest-dark',
      'manifest-graphite-dark',
    ])
    expect(themesForScheme('light').map(theme => theme.id)).toEqual([
      'manifest-light',
      'manifest-graphite-light',
    ])
    expect(themesForScheme('dark').map(theme => theme.id)).toEqual([
      'manifest-dark',
      'manifest-graphite-dark',
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
    const graphitePreference = {
      ...DEFAULT_APPEARANCE_PREFERENCE,
      lightThemeId: 'manifest-graphite-light',
      darkThemeId: 'manifest-graphite-dark',
    }
    expect(resolveTheme(graphitePreference, 'light').id).toBe('manifest-graphite-light')
    expect(resolveTheme(graphitePreference, 'dark').id).toBe('manifest-graphite-dark')
    expect(resolveTheme({ ...graphitePreference, mode: 'light' }, 'dark').id).toBe('manifest-graphite-light')
    expect(resolveTheme({ ...graphitePreference, mode: 'dark' }, 'light').id).toBe('manifest-graphite-dark')
    expect(resolveTheme(graphitePreference, 'light').tokens['surface-canvas'])
      .not.toBe(resolveTheme(DEFAULT_APPEARANCE_PREFERENCE, 'light').tokens['surface-canvas'])
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
    expect(normalizeAppearancePreference({
      mode: 'system',
      lightThemeId: 'manifest-graphite-light',
      darkThemeId: 'manifest-graphite-dark',
    })).toEqual({
      mode: 'system',
      lightThemeId: 'manifest-graphite-light',
      darkThemeId: 'manifest-graphite-dark',
    })
    expect(normalizeAppearancePreference({
      mode: 'system',
      lightThemeId: 'manifest-graphite-dark',
      darkThemeId: 'manifest-graphite-light',
    })).toEqual(DEFAULT_APPEARANCE_PREFERENCE)
  })

  it('keeps CSS bootstrap token values aligned with the built-in themes', () => {
    const css = postcss.parse(readFileSync(join(__dirname, '../../../src/renderer/src/app.css'), 'utf8'))

    expect(cssBootstrapTokens(css, 'light')).toEqual(
      cssTokensForTheme(DEFAULT_APPEARANCE_PREFERENCE.lightThemeId),
    )
    expect(cssBootstrapTokens(css, 'dark')).toEqual(
      cssTokensForTheme(DEFAULT_APPEARANCE_PREFERENCE.darkThemeId),
    )
  })
})

function cssBootstrapTokens(css: Root, scheme: 'light' | 'dark'): Record<string, string> {
  let bootstrapRoot: Container | undefined

  if (scheme === 'light') {
    css.walkRules(':root', rule => {
      if (rule.parent === css) bootstrapRoot = rule
    })
  } else {
    css.walkAtRules('media', media => {
      if (media.params.replace(/\s+/g, ' ') !== '(prefers-color-scheme: dark)') return
      media.walkRules(':root', rule => {
        if (rule.parent === media) bootstrapRoot = rule
      })
    })
  }

  expect(bootstrapRoot).toBeDefined()
  const declarations: Array<[string, string]> = []
  let colorScheme: string | undefined
  bootstrapRoot!.walkDecls(declaration => {
    if (declaration.prop === 'color-scheme') colorScheme = declaration.value
    if (declaration.prop.startsWith('--theme-')) {
      declarations.push([declaration.prop.slice('--theme-'.length), declaration.value])
    }
  })

  expect(colorScheme).toBe(scheme)
  expect(declarations).toHaveLength(THEME_TOKEN_NAMES.length)
  expect(new Set(declarations.map(([name]) => name))).toHaveLength(THEME_TOKEN_NAMES.length)
  return Object.fromEntries(declarations)
}

function cssTokensForTheme(id: string): Record<string, string> {
  const theme = BUILT_IN_THEMES.find(candidate => candidate.id === id)
  expect(theme).toBeDefined()

  return Object.fromEntries(
    THEME_TOKEN_NAMES.map(name => [name, hexToRgb(theme!.tokens[name])]),
  )
}

function hexToRgb(hex: string): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!match) throw new Error(`Expected a six-digit hex color, received ${hex}`)
  return match.slice(1).map(component => String(Number.parseInt(component, 16))).join(' ')
}
