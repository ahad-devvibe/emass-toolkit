import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Proxy /api so the browser sees one origin: the sameSite=strict refresh
  // cookie then works on localhost and on the LAN address alike
  // Long timeouts so release uploads (up to 1 GiB) aren't cut off in dev
  const uploadTimeoutMs = 2 * 60 * 60 * 1000
  const proxy = {
    '/api': {
      target: env.VITE_API_TARGET || 'http://localhost:5000',
      changeOrigin: false,
      timeout: uploadTimeoutMs,
      proxyTimeout: uploadTimeoutMs,
    },
  }

  // The proxy timeouts above only cover the hop to the API. Vite's own HTTP
  // server keeps Node's 5-minute requestTimeout, which cut off any upload
  // slower than that (the API still saved it; the browser saw a 408)
  // (HTTP/2 servers, used only with https, have no such limit)
  const raiseTimeout = (httpServer: unknown) => {
    if (httpServer && typeof httpServer === 'object' && 'requestTimeout' in httpServer) httpServer.requestTimeout = uploadTimeoutMs
  }
  const uploadTimeouts: Plugin = {
    name: 'upload-timeouts',
    configureServer: (server) => raiseTimeout(server.httpServer),
    configurePreviewServer: (server) => raiseTimeout(server.httpServer),
  }

  return {
    plugins: [react(), tailwindcss(), uploadTimeouts],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    // Listen on all interfaces so the app is reachable on localhost and the LAN at the same port
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      proxy,
    },
    preview: {
      host: true,
      port: 4173,
      strictPort: true,
      proxy,
    },
  }
})
