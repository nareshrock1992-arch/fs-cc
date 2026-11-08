import { defineConfig } from 'vitest/config';

// Unit tests for the WebRTC softphone feature only (src/features/softphone).
// Kept separate from vite.config.js so the existing dev/build configuration is untouched.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/features/softphone/**/*.test.{ts,js,jsx}'],
    pool: 'vmThreads',
    passWithNoTests: true,
  },
});
