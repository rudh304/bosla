import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /e2e\.spec\.js/,
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:4173',
    locale: 'ar-SA',
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'mobile-360', use: { browserName: 'chromium', viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { name: 'laptop', use: { browserName: 'chromium', viewport: { width: 1366, height: 768 } } }
  ],
  webServer: process.env.BASE_URL ? undefined : {
    command: 'node scripts/serve.mjs 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: true
  }
});
