import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Proxy /api so the browser sees one origin: the sameSite=strict refresh
  // cookie then works on localhost and on the LAN address alike
  const proxy = {
    '/api': { target: env.VITE_API_TARGET || 'http://localhost:5000', changeOrigin: false },
  }

  return {
    plugins: [react(), tailwindcss()],
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
