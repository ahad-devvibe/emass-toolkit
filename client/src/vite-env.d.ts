/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where "Contact support" sends customers; the button is disabled when unset */
  readonly VITE_SUPPORT_EMAIL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
