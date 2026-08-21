import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

fs.mkdirSync(path.resolve('artifacts/playwright'), { recursive: true });
const e2eDatabasePath = path.resolve('src/backend/TokenWarehouse.Api/token-warehouse.db');
for (const suffix of ['', '-shm', '-wal']) {
  fs.rmSync(`${e2eDatabasePath}${suffix}`, { force: true });
}

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'artifacts/playwright/test-results',
  fullyParallel: false,
  retries: process.env['CI'] ? 2 : 0,
  reporter: [['list'], ['html', { outputFolder: 'artifacts/playwright/report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4200',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'dotnet run --project src/backend/TokenWarehouse.Api/TokenWarehouse.Api.csproj --no-launch-profile --urls http://127.0.0.1:5100',
      url: 'http://127.0.0.1:5100/health',
      name: 'api',
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        ASPNETCORE_ENVIRONMENT: 'Testing',
        TOKEN_WAREHOUSE_E2E_SEED: 'true',
      },
    },
    {
      command: 'npm run start:web',
      url: 'http://127.0.0.1:4200',
      name: 'web',
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
