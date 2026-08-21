import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const playwrightArtifactsPath = path.resolve('artifacts/playwright');
fs.mkdirSync(playwrightArtifactsPath, { recursive: true });
const configuredDatabaseDirectory = process.env['TOKEN_WAREHOUSE_E2E_DATABASE_DIRECTORY'];
const e2eDatabaseDirectory = configuredDatabaseDirectory
  ?? fs.mkdtempSync(path.join(playwrightArtifactsPath, 'e2e-'));
const e2eDatabasePath = path.join(e2eDatabaseDirectory, 'token-warehouse.db');
const configuredLockPath = process.env['TOKEN_WAREHOUSE_E2E_LOCK_PATH'];
const e2eLockPath = configuredLockPath ?? path.join(path.dirname(e2eDatabasePath), 'e2e.lock');
process.env['TOKEN_WAREHOUSE_E2E_DATABASE_DIRECTORY'] = e2eDatabaseDirectory;
process.env['TOKEN_WAREHOUSE_E2E_DATABASE_PATH'] = e2eDatabasePath;
process.env['TOKEN_WAREHOUSE_E2E_LOCK_PATH'] = e2eLockPath;

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
        TOKEN_WAREHOUSE_WAREHOUSE_DATE: '2030-01-15',
        TOKEN_WAREHOUSE_UTC_NOW: '2030-01-15T10:00:00Z',
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
