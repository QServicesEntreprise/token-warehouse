import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { join } from 'node:path';

const root = new URL('../', import.meta.url).pathname;

const projectReferences = async (path) => {
  const project = await readFile(join(root, path), 'utf8');
  return [...project.matchAll(/ProjectReference Include="([^"]+)"/g)].map((match) => match[1]);
};

const packageReferences = async (path) => {
  const project = await readFile(join(root, path), 'utf8');
  return [...project.matchAll(/PackageReference Include="([^"]+)"/g)].map((match) => match[1]);
};

test('production project references keep the dependency direction', async () => {
  assert.deepEqual(await projectReferences('src/backend/TokenWarehouse.Domain/TokenWarehouse.Domain.csproj'), []);
  assert.deepEqual(await projectReferences('src/backend/TokenWarehouse.Application/TokenWarehouse.Application.csproj'), [
    '../TokenWarehouse.Domain/TokenWarehouse.Domain.csproj',
  ]);
  assert.deepEqual(await projectReferences('src/backend/TokenWarehouse.Infrastructure/TokenWarehouse.Infrastructure.csproj'), [
    '../TokenWarehouse.Application/TokenWarehouse.Application.csproj',
  ]);
  assert.deepEqual(
    (await projectReferences('src/backend/TokenWarehouse.Api/TokenWarehouse.Api.csproj')).sort(),
    [
      '../TokenWarehouse.Application/TokenWarehouse.Application.csproj',
      '../TokenWarehouse.Infrastructure/TokenWarehouse.Infrastructure.csproj',
    ].sort(),
  );
});

test('framework packages stay at the adapter edges', async () => {
  assert.deepEqual(await packageReferences('src/backend/TokenWarehouse.Domain/TokenWarehouse.Domain.csproj'), []);
  assert.deepEqual(await packageReferences('src/backend/TokenWarehouse.Application/TokenWarehouse.Application.csproj'), []);
  assert.deepEqual((await packageReferences('src/backend/TokenWarehouse.Infrastructure/TokenWarehouse.Infrastructure.csproj')).sort(), [
    'Microsoft.Data.Sqlite',
    'Microsoft.EntityFrameworkCore.Design',
    'Microsoft.EntityFrameworkCore.Sqlite',
    'Microsoft.Extensions.DependencyInjection.Abstractions',
    'Microsoft.Extensions.Hosting.Abstractions',
  ].sort());
  assert.deepEqual(await packageReferences('src/backend/TokenWarehouse.Api/TokenWarehouse.Api.csproj'), [
    'Microsoft.EntityFrameworkCore.Design',
  ]);
});

test('the generic Stock sale seam does not interpret Ventes pricing data', async () => {
  const stockSale = await readFile(
    join(root, 'src/backend/TokenWarehouse.Application/StockSale.cs'),
    'utf8',
  );
  const stockCommitter = await readFile(
    join(root, 'src/backend/TokenWarehouse.Infrastructure/Persistence/SqliteStockMutationCommitter.cs'),
    'utf8',
  );

  assert.doesNotMatch(stockSale, /SaleFinancialSnapshot|SaleContext|SaleFinancialSnapshotSerializer/);
  assert.doesNotMatch(stockCommitter, /SaleFinancialSnapshot|SaleContext|SaleFinancialSnapshotSerializer/);
});

test('the scaffold does not add explicitly forbidden abstractions', async () => {
  const walk = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) files.push(...await walk(path));
      else if (/\.(cs|csproj)$/.test(entry.name)) files.push(path);
    }
    return files;
  };

  const files = await walk(join(root, 'src/backend'));
  const source = (await Promise.all(files.map((path) => readFile(path, 'utf8')))).join('\n');
  assert.doesNotMatch(source, /MediatR|GenericRepository|\bCQRS\b|EventBus/i);
});

test('documented cleanup removes the manual API SQLite database and sidecars', async () => {
  const settings = JSON.parse(
    await readFile(join(root, 'src/backend/TokenWarehouse.Api/appsettings.json'), 'utf8'),
  );
  const dataSource = settings.ConnectionStrings.Warehouse.match(/Data Source=([^;]+)/)?.[1];
  assert.ok(dataSource && !dataSource.includes('/') && !dataSource.includes('\\'));

  const readme = await readFile(join(root, 'README.md'), 'utf8');
  const manualDatabasePath = `src/backend/TokenWarehouse.Api/${dataSource}`;
  for (const suffix of ['', '-shm', '-wal']) {
    assert.ok(readme.includes(`${manualDatabasePath}${suffix}`));
  }
});

test('Playwright fixtures isolate the manual SQLite database', async () => {
  const config = await readFile(join(root, 'playwright.config.ts'), 'utf8');
  const fixture = await readFile(join(root, 'tests/e2e/fixtures.ts'), 'utf8');

  assert.match(config, /path\.resolve\('artifacts\/playwright', webPort\)/);
  assert.match(config, /command: `npx ng serve token-warehouse-web --host 127\.0\.0\.1 --port \$\{webPort\}`/);
  assert.match(config, /workers: 1/);
  assert.match(fixture, /fs\.mkdtempSync\(path\.join\(playwrightArtifactsPath, 'e2e-'\)\)/);
  assert.match(fixture, /spawn\(/);
  assert.match(fixture, /await use\(\)/);
  assert.match(fixture, /ConnectionStrings__Warehouse: `Data Source=\$\{databasePath\}`/);
  assert.match(fixture, /fs\.rmSync\(databaseDirectory, \{ recursive: true, force: true \}\)/);
  assert.doesNotMatch(config, /src\/backend\/TokenWarehouse\.Api\/token-warehouse\.db/);
  assert.doesNotMatch(config, /ConnectionStrings__Warehouse/);
});

test('Playwright runs claim their ports instead of sharing fixed ones', async () => {
  const config = await readFile(join(root, 'playwright.config.ts'), 'utf8');
  const fixture = await readFile(join(root, 'tests/e2e/fixtures.ts'), 'utf8');
  const proxy = await readFile(join(root, 'proxy.conf.cjs'), 'utf8');
  const e2eSources = await Promise.all(
    (await readdir(join(root, 'tests/e2e'), { recursive: true }))
      .filter((entry) => entry.endsWith('.ts'))
      .map((entry) => readFile(join(root, 'tests/e2e', entry), 'utf8')),
  );

  // Concurrent runners must never contend for the same listener.
  assert.match(config, /process\.env\['TOKEN_WAREHOUSE_WEB_PORT'\] \?\?= reservePort\(\)/);
  assert.match(config, /process\.env\['TOKEN_WAREHOUSE_API_PORT'\] \?\?= reservePort\(\)/);
  assert.match(config, /TOKEN_WAREHOUSE_API_PORT: apiPort/);
  assert.match(fixture, /export const apiUrl = `http:\/\/127\.0\.0\.1:\$\{process\.env\['TOKEN_WAREHOUSE_API_PORT'\]/);
  assert.match(proxy, /process\.env\['TOKEN_WAREHOUSE_API_PORT'\]/);

  // A hardcoded port anywhere reintroduces the collision.
  assert.doesNotMatch(config, /127\.0\.0\.1:(4200|5100)/);
  for (const source of e2eSources) {
    assert.doesNotMatch(source, /127\.0\.0\.1:(4200|5100)/);
  }
});
