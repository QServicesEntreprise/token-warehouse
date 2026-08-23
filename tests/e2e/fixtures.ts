import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test as base } from '@playwright/test';

// Assigned per run by playwright.config.ts; the fallback keeps a plain
// `npx playwright test` working if the config was bypassed.
export const apiUrl = `http://127.0.0.1:${process.env['TOKEN_WAREHOUSE_API_PORT'] ?? '5100'}`;
const playwrightArtifactsPath = path.resolve('artifacts/playwright');
const repositoryRoot = path.resolve(playwrightArtifactsPath, '../..');
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitForApi = async (server: ChildProcess): Promise<void> => {
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`The per-test API exited with code ${server.exitCode}.`);
    }

    try {
      if ((await fetch(`${apiUrl}/health`)).ok) {
        return;
      }
    } catch {
      // The API is still starting.
    }

    await wait(250);
  }

  throw new Error('The per-test API did not become ready within 120 seconds.');
};

const stopApi = async (server: ChildProcess): Promise<void> => {
  if (server.pid === undefined || server.exitCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      try {
        process.kill(process.platform === 'win32' ? server.pid! : -server.pid!, 'SIGKILL');
      } catch {
        // The process already exited.
      }
      resolve();
    }, 10_000);

    server.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });

    try {
      process.kill(process.platform === 'win32' ? server.pid : -server.pid, 'SIGTERM');
    } catch {
      clearTimeout(timeout);
      resolve();
    }
  });
};

type Fixtures = {
  isolatedApi: void;
  historyReadFailure: boolean;
  e2eSeed: 'true' | 'empty' | 'flows' | 'flows-boundary' | 'financial';
  saleCommitGateEnabled: boolean;
  saleCommitGate: {
    directory: string;
    waitUntilValidated: () => Promise<void>;
    release: () => void;
  };
};

export const test = base.extend<Fixtures>({
  historyReadFailure: [false, { option: true }],
  e2eSeed: ['true', { option: true }],
  saleCommitGateEnabled: [false, { option: true }],
  saleCommitGate: async ({}, use) => {
    fs.mkdirSync(playwrightArtifactsPath, { recursive: true });
    const directory = fs.mkdtempSync(path.join(playwrightArtifactsPath, 'sale-commit-gate-'));
    const validatedPath = path.join(directory, 'validated');
    const releasePath = path.join(directory, 'release');
    await use({
      directory,
      waitUntilValidated: async () => {
        const deadline = Date.now() + 10_000;
        while (!fs.existsSync(validatedPath)) {
          if (Date.now() >= deadline) {
            throw new Error('The Sale commit gate was not reached within 10 seconds.');
          }
          await wait(25);
        }
      },
      release: () => fs.writeFileSync(releasePath, ''),
    });
    fs.rmSync(directory, { recursive: true, force: true });
  },
  isolatedApi: [async ({
    historyReadFailure,
    e2eSeed,
    saleCommitGateEnabled,
    saleCommitGate,
  }, use) => {
    fs.mkdirSync(playwrightArtifactsPath, { recursive: true });
    const databaseDirectory = fs.mkdtempSync(path.join(playwrightArtifactsPath, 'e2e-'));
    const databasePath = path.join(databaseDirectory, 'token-warehouse.db');
    const server = spawn(
      'dotnet',
      [
        'run',
        '--project',
        path.join(repositoryRoot, 'src/backend/TokenWarehouse.Api/TokenWarehouse.Api.csproj'),
        '--no-launch-profile',
        '--urls',
        apiUrl,
      ],
      {
        cwd: repositoryRoot,
        detached: true,
        env: {
          ...process.env,
          ASPNETCORE_ENVIRONMENT: 'Testing',
          TOKEN_WAREHOUSE_E2E_SEED: e2eSeed,
          TOKEN_WAREHOUSE_HISTORY_FAILURE: historyReadFailure ? 'true' : 'false',
          TOKEN_WAREHOUSE_SALE_COMMIT_GATE: saleCommitGateEnabled ? saleCommitGate.directory : '',
          TOKEN_WAREHOUSE_WAREHOUSE_DATE: '2030-01-15',
          TOKEN_WAREHOUSE_UTC_NOW: '2030-01-15T10:00:00Z',
          Warehouse__TimeZoneId: 'Etc/GMT-2',
          ConnectionStrings__Warehouse: `Data Source=${databasePath}`,
        },
        stdio: 'ignore',
      },
    );

    try {
      await waitForApi(server);
      await use();
    } finally {
      await stopApi(server);
      fs.rmSync(databaseDirectory, { recursive: true, force: true });
    }
  }, { auto: true }],
});
