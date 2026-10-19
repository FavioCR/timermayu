import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Se publica en timer.practi.dev/pendientes/
  base: '/pendientes/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    // En desarrollo el API corre aparte: cd ../pendientes-api && AUTH_PASSWORD=... DATA_DIR=./data npm start
    proxy: { '/api/pendientes': 'http://localhost:3000' },
  },
})
