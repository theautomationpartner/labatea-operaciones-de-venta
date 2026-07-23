/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Token de API de Monday para desarrollo local (opcional; ver .env.local.example). */
  readonly VITE_MONDAY_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
