import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// Kept separate from vite.config.ts: vitest bundles its own vite copy, and
// merging the two configs makes the plugin types structurally incompatible.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
