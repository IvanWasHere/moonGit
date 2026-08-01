// defineConfig comes from vitest/config (not vite) so the `test` block below
// is typed. It is a superset of Vite's own defineConfig.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // Wails serves from an embedded FS; source maps help the dev-mode log viewer.
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: true,
    coverage: {
      provider: 'v8',
      // Parsers are the highest-value tests in the codebase (PLAN.md §5).
      include: ['src/services/**', 'src/utils/**', 'src/stores/**'],
    },
  },
});
