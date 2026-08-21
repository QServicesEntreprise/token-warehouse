import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const playwrightArtifactsPath = path.resolve('artifacts/playwright');
fs.mkdirSync(playwrightArtifactsPath, { recursive: true });
const e2eDatabaseDirectory = fs.mkdtempSync(path.join(playwrightArtifactsPath, 'e2e-'));
const e2eDatabasePath = path.join(e2eDatabaseDirectory, 'token-warehouse.db');

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
        ConnectionStrings__Warehouse: `Data Source=${e2eDatabasePath}`,
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
