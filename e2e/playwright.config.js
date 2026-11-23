import { defineConfig } from '@playwright/test';

// Started by e2e/run.sh, which brings up the isolated stack and sets E2E_* variables.
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 0,              // a flaky test is investigated, not retried
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'report' }]],
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  outputDir: 'test-results',
});
