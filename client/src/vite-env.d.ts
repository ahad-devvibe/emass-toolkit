/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The API's origin (e.g. https://api.example.com) when the build is hosted without an /api proxy */
  readonly VITE_API_BASE_URL?: string
  /** Where "Contact support" sends customers; the button is disabled when unset */
  readonly VITE_SUPPORT_EMAIL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
