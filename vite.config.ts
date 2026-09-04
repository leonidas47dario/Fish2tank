import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import {
  cloudDatabaseUrlFor, databaseNameFor, deploymentFor, mediaWorkerUrlFor,
} from './src/data/environment';

// Project Pages serves from /<repo>/, so the base path has to be baked in at
// build time. Left as '/' for dev and for any host that serves from the root
// (Netlify, Cloudflare Pages, Vercel).
const base = process.env.VITE_BASE ?? '/';

// Staging lives under the production base (/Fish2tank/uat/), which means a
// service worker registered for production has a scope that CONTAINS staging.
// Left alone, a user who visits production first would then get production's
// cached shell served for every /uat/ navigation, and staging would silently
// show the wrong build. Production therefore disowns the /uat/ subtree.
const isStaging = base.endsWith('/uat/');
const navigateFallbackDenylist = [/^\/api\//, ...(isStaging ? [] : [/\/uat(\/|$)/])];

// Which build is actually running, baked in so the app can say so out loud.
//
// A service worker means the code on a device is NOT necessarily the code that
// was deployed - a stale precached shell looks identical to a failed fix, and
// "did the deploy land?" becomes unanswerable from either end. Settings shows
// this, so a UAT report can name its build instead of guessing at it.
// GITHUB_SHA is set by Actions; a local build honestly says so.
const buildId = (process.env.GITHUB_SHA ?? 'local').slice(0, 7);
const builtAt = new Date().toISOString();

export default defineConfig({
  base,
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
    __BUILT_AT__: JSON.stringify(builtAt),
    // BUG-04: staging and production share an origin, so they shared one
    // IndexedDB. The rule lives in src/data/environment.ts so it is testable.
    __DB_NAME__: JSON.stringify(databaseNameFor(base)),
    // Spec 005: which cloud database, and which tier the logs should name.
    // Not secret - the URL ships in the bundle by design and the database
    // whitelists origins. Secrets live in Dexie Cloud Manager.
    __CLOUD_DB_URL__: JSON.stringify(cloudDatabaseUrlFor(base)),
    __DEPLOYMENT__: JSON.stringify(deploymentFor(base)),
    // Empty for an unrecognised build: media sync is off rather than aimed
    // at a Worker that would reject its tokens. See environment.ts.
    __MEDIA_WORKER_URL__: JSON.stringify(mediaWorkerUrlFor(base)),
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    // FR-O01 / NFR-07: installable, mobile-first, works offline (NFR-02).
    VitePWA({
      registerType: 'autoUpdate',
      // Registration lives in src/pwa.ts instead: the injected script is a bare
      // register() that never reloads, which made a new deploy show up only on
      // the second visit. See the note there.
      injectRegister: null,
      includeAssets: ['favicon.svg'],
      manifest: {
        // Distinguishable on the home screen, so an installed staging build
        // is never mistaken for production.
        name: isStaging ? 'Fish2Tank (UAT)' : 'Fish2Tank',
        short_name: isStaging ? 'F2T UAT' : 'Fish2Tank',
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
        /*
         * THE CORE portraits are precached, the TAIL is not - spec 059.
         *
         * Precaching every portrait was measured at 984 files and 20.8 MB, 83%
         * of a 25.1 MB install that every device paid before the app worked
         * offline at all, a stranger opening a share link included. Spec 058
         * then took coverage from 989 species to 2,027, which would have made
         * that roughly 46 MB.
         *
         * The split is by directory because this manifest is built from the
         * OUTPUT, where a bundled asset's name is a content hash - there is no
         * way to say "precache these two hundred" from here otherwise. The core
         * lives in `src/data/seed/assets/portraits` and arrives as a hashed
         * asset; the tail is copied verbatim from `public/portraits`, which is
         * what `globIgnores` excludes and `runtimeCaching` picks up below.
         *
         * NFR-02 IS NARROWED BY THIS, and the spec says so rather than leaving
         * it to be discovered: the promise moves from "the whole catalog draws
         * offline" to "the core draws offline, and so does everything you have
         * looked at".
         */
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,woff2}'],
        globIgnores: ['portraits/**'],
        runtimeCaching: [{
          urlPattern: ({ url }) => url.pathname.includes('/portraits/'),
          handler: 'CacheFirst',
          options: {
            cacheName: 'portraits-tail',
            /*
             * A portrait is immutable for as long as its species id is - the
             * file is only rewritten when the ETL replaces the photograph - so
             * CacheFirst never revalidates and a replacement is stale until the
             * entry ages out. 30 days is the deliberate ceiling on that.
             *
             * maxEntries bounds the disk this can take: 1,827 tail portraits at
             * the measured 21.6 KB mean is ~39 MB if a keeper somehow opened
             * every one, so the cap is what keeps "browse the whole catalog"
             * from quietly costing more than the precache did.
             */
            expiration: { maxEntries: 600, maxAgeSeconds: 30 * 24 * 60 * 60 },
            cacheableResponse: { statuses: [0, 200] },
          },
        }],
        /*
         * ~1MB of portraits pushed past the 2MiB default; spec 056's care
         * backfill pushed the app bundle itself past 4MiB.
         *
         * RAISED RATHER THAN LET IT FALL OUT OF THE PRECACHE. The over-limit
         * asset is `index-*.js` - the app shell - and Workbox does not fail on
         * one, it silently omits it, which would break NFR-02 outright: a
         * catalog that cannot draw itself offline. The build errors instead,
         * which is how this was noticed.
         *
         * The cost is smaller than it looks. The mart is inlined into the
         * bundle (ENH-02), so 456 species of care data grew it 1.79 -> 2.46 MB
         * raw but only 636 -> 672 KB gzipped: +35 KB over the wire.
         */
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // Media originals live in IndexedDB, never in the SW cache (NFR-03).
        // /uat/ is excluded from production's scope; see the note above.
        navigateFallbackDenylist,
      },
    }),
  ],
});
