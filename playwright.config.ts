import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const playwrightArtifactsPath = path.resolve('artifacts/playwright');
fs.mkdirSync(playwrightArtifactsPath, { recursive: true });

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'artifacts/playwright/test-results',
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 2 : 0,
  reporter: [['list'], ['html', { outputFolder: 'artifacts/playwright/report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4200',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run start:web',
    url: 'http://127.0.0.1:4200',
    name: 'web',
    timeout: 120_000,
    reuseExistingServer: false,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
