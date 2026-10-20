import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // Se publica en timer.practi.dev/pendientes/
  base: '/pendientes/',
  plugins: [
    react(),
    tailwindcss(),
    // Se puede instalar como app de escritorio (manifiesto + service worker). El service worker no guarda la app de
    // antemano: la página siempre se pide a la red (cada despliegue se ve al recargar, como antes) y lo guardado solo
    // se usa sin conexión. Las llamadas al API no pasan por él. Se registra en src/lib/instalar.ts.
    VitePWA({
      injectRegister: false,
      registerType: 'autoUpdate',
      manifest: {
        id: '/pendientes/',
        name: 'Pendientes',
        short_name: 'Pendientes',
        description: 'El tablero de pendientes del equipo.',
        lang: 'es',
        start_url: '/pendientes/',
        scope: '/pendientes/',
        display: 'standalone',
        background_color: '#0a0e17',
        theme_color: '#0a0e17',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['*.{png,svg}'],
        navigateFallback: null,
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) => request.mode === 'navigate' && url.pathname.startsWith('/pendientes/'),
            handler: 'NetworkFirst',
            options: { cacheName: 'paginas', networkTimeoutSeconds: 6, expiration: { maxEntries: 5 } },
          },
          {
            // Llevan el hash en el nombre: lo guardado nunca cambia.
            urlPattern: ({ url }) => url.pathname.startsWith('/pendientes/assets/'),
            handler: 'CacheFirst',
            options: { cacheName: 'assets', expiration: { maxEntries: 80, maxAgeSeconds: 30 * 24 * 60 * 60 } },
          },
        ],
      },
    }),
  ],
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
