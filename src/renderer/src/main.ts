import { mount } from 'svelte'
import App from './App.svelte'
import SettingsWindow from './SettingsWindow.svelte'
import { applyAppearancePreference, watchSystemAppearance } from './lib/theme'
import './app.css'

// Both the project window and the Settings window enter through this module.
// Applying preferences here keeps their appearance synchronized without making
// every Svelte screen responsible for theme lifecycle code.
watchSystemAppearance()
window.api.settings.onPreferencesChanged((preferences) => {
  applyAppearancePreference(preferences.appearance)
})
void window.api.settings.getPreferences().then((result) => {
  if (result.ok) applyAppearancePreference(result.data.appearance)
})

const component = new URLSearchParams(window.location.search).has('settings')
  ? SettingsWindow
  : App

mount(component, { target: document.getElementById('app')! })
