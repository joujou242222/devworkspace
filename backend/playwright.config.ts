import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.local/browsers');
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    actionTimeout: 10000,
    baseURL: 'https://localhost:8443',
    ignoreHTTPSErrors: true,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  outputDir: '.local/playwright-results',
});
