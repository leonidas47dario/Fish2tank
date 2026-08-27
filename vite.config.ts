import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

// Project Pages serves from /<repo>/, so the base path has to be baked in at
// build time. Left as '/' for dev and for any host that serves from the root
// (Netlify, Cloudflare Pages, Vercel).
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    // FR-O01 / NFR-07: installable, mobile-first, works offline (NFR-02).
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Fish2Tank',
        short_name: 'Fish2Tank',
        description: 'Catch the encounter. Keep every story.',
        theme_color: '#0b1d2a',
        background_color: '#0b1d2a',
        display: 'standalone',
        orientation: 'portrait',
        id: base,
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Media originals live in IndexedDB, never in the SW cache (NFR-03).
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
});
