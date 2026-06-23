/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_WS_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  __KALIO_RUNTIME_CONFIG__?: {
    apiUrl?: string
    wsUrl?: string
  }
}
