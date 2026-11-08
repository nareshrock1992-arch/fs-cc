import { defineConfig } from 'vitest/config';

// Unit tests: WebRTC softphone (src/features/softphone) and the Agent Desktop shell/UI kit.
// Kept separate from vite.config.js so the existing dev/build configuration is untouched.
export default defineConfig({
  // Automatic JSX runtime so components that don't import React (e.g. ThemeToggle) render in tests.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    include: ['src/features/softphone/**/*.test.{ts,js,jsx}', 'src/shell/**/*.test.{js,jsx}', 'src/ui/**/*.test.{js,jsx}'],
    pool: 'vmThreads',
    passWithNoTests: true,
  },
});
