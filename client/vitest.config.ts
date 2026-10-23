import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

// Pure logic only (mappers, transport, upload queue): no DOM, tests sit next to the code
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
