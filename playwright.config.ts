import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Ask the OS for a free port. Playwright re-evaluates this config in every worker
// process, so the chosen ports are written back into the environment: the first
// evaluation reserves, every later one reuses. Setting the variables explicitly
// pins the run to fixed ports instead.
// ponytail: a few milliseconds pass between closing the probe socket and the
// child binding it. Ephemeral ports make a collision unlikely; move to a lock
// file only if concurrent runners ever actually clash.
const reservePort = (): string =>
  execFileSync(process.execPath, [
    '-e',
    "const s=require('net').createServer();"
      + "s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close();});",
  ]).toString();

const webPort = (process.env['TOKEN_WAREHOUSE_WEB_PORT'] ??= reservePort());
const apiPort = (process.env['TOKEN_WAREHOUSE_API_PORT'] ??= reservePort());

const baseURL = `http://127.0.0.1:${webPort}`;

// Keyed by port so concurrent runners never overwrite each other's traces or report.
const playwrightArtifactsPath = path.resolve('artifacts/playwright', webPort);
fs.mkdirSync(playwrightArtifactsPath, { recursive: true });

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: path.join(playwrightArtifactsPath, 'test-results'),
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 2 : 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(playwrightArtifactsPath, 'report'), open: 'never' }],
  ],
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx ng serve token-warehouse-web --host 127.0.0.1 --port ${webPort}`,
    url: baseURL,
    name: 'web',
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      // Read by proxy.conf.cjs so the dev server proxies to this run's API.
      TOKEN_WAREHOUSE_API_PORT: apiPort,
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
