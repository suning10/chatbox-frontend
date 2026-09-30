import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // The backend (ToolBoxV2) is a separate FastAPI service — proxy /api in dev so the
      // browser never has to deal with CORS, and VITE_API_BASE_URL can stay unset locally.
      // See .env.example for pointing this at a non-default backend.
      '/api': {
        target: process.env.VITE_DEV_PROXY_TARGET ?? 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
  },
})
