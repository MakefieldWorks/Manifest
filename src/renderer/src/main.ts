import { mount } from 'svelte'
import App from './App.svelte'
import SettingsWindow from './SettingsWindow.svelte'
import './app.css'

const component = new URLSearchParams(window.location.search).has('settings')
  ? SettingsWindow
  : App

mount(component, { target: document.getElementById('app')! })
