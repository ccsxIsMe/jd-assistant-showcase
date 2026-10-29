import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000',
    browserName: 'chromium',
    channel: 'msedge',
    headless: true,
    acceptDownloads: true,
    screenshot: 'only-on-failure',
  },
  reporter: 'list',
});
