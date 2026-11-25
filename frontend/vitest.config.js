import { defineConfig } from 'vitest/config';

// Admin portal unit/UI tests (TEST-1). Kept separate from vite.config.js so the
// dev/build configuration is untouched. Same style as agent-desktop/vitest.config.js.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    setupFiles: ['src/test/setup.js'],
    pool: 'vmThreads',
  },
});
