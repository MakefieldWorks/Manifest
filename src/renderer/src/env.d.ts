/// <reference types="svelte" />

import type { LayertrailAPI } from '../../shared/ipc'

declare global {
  interface Window {
    api: LayertrailAPI
  }
}

export {}
