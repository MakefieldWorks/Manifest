import {
  DEFAULT_APPEARANCE_PREFERENCE,
  resolveTheme,
  type AppearancePreference,
  type HexColor,
} from '../../../shared/theme'

const systemScheme = window.matchMedia('(prefers-color-scheme: dark)')
let preference: AppearancePreference = { ...DEFAULT_APPEARANCE_PREFERENCE }

/** Apply a validated theme definition to the document without a page reload. */
export function applyAppearancePreference(next: AppearancePreference): void {
  preference = { ...next }
  applyResolvedTheme()
}

/** Keep a System appearance choice current when the operating system changes. */
export function watchSystemAppearance(): () => void {
  const handleChange = () => {
    if (preference.mode === 'system') applyResolvedTheme()
  }
  systemScheme.addEventListener('change', handleChange)
  return () => systemScheme.removeEventListener('change', handleChange)
}

function applyResolvedTheme(): void {
  const theme = resolveTheme(preference, systemScheme.matches ? 'dark' : 'light')
  const root = document.documentElement

  root.dataset.theme = theme.id
  root.dataset.themeScheme = theme.scheme
  root.style.colorScheme = theme.scheme

  for (const [token, color] of Object.entries(theme.tokens)) {
    root.style.setProperty(`--theme-${token}`, hexToRgbChannels(color))
  }
}

function hexToRgbChannels(color: HexColor): string {
  const value = color.slice(1)
  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)
  return `${red} ${green} ${blue}`
}
