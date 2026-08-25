import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { dirname, join, relative, resolve } from 'node:path';

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

test('Angular routing shell is composition-only and contains no legacy route', async () => {
  const appDirectory = join(root, 'src/web/app');
  const app = await readFile(join(appDirectory, 'app.ts'), 'utf8');
  const template = await readFile(join(appDirectory, 'app.html'), 'utf8');
  const routes = await readFile(join(appDirectory, 'app.routes.ts'), 'utf8');
  const config = await readFile(join(appDirectory, 'app.config.ts'), 'utf8');

  assert.match(app, /RouterLink/);
  assert.match(app, /RouterLinkActive/);
  assert.match(app, /RouterOutlet/);
  assert.doesNotMatch(app, /HttpClient|ApiService|\bsignal\s*\(|\bcomputed\s*\(|\binject\s*\(/);
  assert.match(template, /routerLink=/);
  assert.match(template, /routerLinkActive=/);
  assert.match(template, /<router-outlet\s*\/?\s*>/);
  assert.doesNotMatch(template, /HttpClient|ApiService|\bsignal\s*\(|\bcomputed\s*\(/);

  for (const [path, routeFile] of [
    ['dashboard', 'dashboard.routes.ts'],
    ['catalogue', '../features/catalogue/catalogue.routes.ts'],
    ['stock', '../features/stock/stock.routes.ts'],
    ['ventes', '../features/sales/sales.routes.ts'],
  ]) {
    assert.match(routes, new RegExp(`path: '${path}'`));
    assert.match(routes, /loadChildren:/);
    const childRoutes = await readFile(join(appDirectory, routeFile), 'utf8');
    assert.match(childRoutes, /loadComponent:/);
    assert.doesNotMatch(childRoutes, /\bcomponent\s*:/);
  }
  assert.match(config, /provideRouter\(routes\)/);
  assert.doesNotMatch(routes, /legacy|Legacy|loadLegacy/);
  assert.doesNotMatch(config, /legacy|Legacy/);
  assert.deepEqual(
    (await readdir(appDirectory)).filter((file) => /legacy|app\.component|dashboard\.component/.test(file)),
    [],
  );
  assert.deepEqual(
    (await readdir(appDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
    [],
  );
});

test('Catalogue is an autonomous lazy context and no longer lives in legacy', async () => {
  const appDirectory = join(root, 'src/web/app');
  const catalogueDirectory = join(root, 'src/web/features/catalogue');
  const routes = await readFile(join(appDirectory, 'app.routes.ts'), 'utf8');
  const catalogueRoutes = await readFile(join(catalogueDirectory, 'catalogue.routes.ts'), 'utf8');

  for (const page of ['catalogue-list-page', 'article-create-page', 'article-details-page']) {
    assert.match(catalogueRoutes, new RegExp(`presentation/${page}`));
  }
  assert.match(routes, /features\/catalogue\/catalogue\.routes/);
  assert.match(catalogueRoutes, /path: 'nouveau'/);
  assert.match(catalogueRoutes, /path: ':ean13'/);
  await assert.rejects(readFile(join(appDirectory, 'article-api.service.ts'), 'utf8'));
  await assert.rejects(readFile(join(appDirectory, 'sale-price-quote.ts'), 'utf8'));
  await assert.rejects(readFile(join(root, 'src/web/features/sales/domain/sale-price-quote.ts'), 'utf8'));

  const layerSources = async (layer) => Promise.all(
    (await readdir(join(catalogueDirectory, layer), { recursive: true }))
      .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.spec.ts'))
      .map((entry) => readFile(join(catalogueDirectory, layer, entry), 'utf8')),
  );
  for (const source of await layerSources('domain')) {
    assert.doesNotMatch(source, /@angular|rxjs|HttpClient|Router|document\.|sessionStorage/);
  }
  for (const source of await layerSources('application')) {
    assert.doesNotMatch(source, /HttpClient|Router|sessionStorage|\b\w+(Dto|Payload|Response)\b/);
  }
  for (const source of await layerSources('presentation')) {
    assert.doesNotMatch(source, /HttpClient|\b\w+(Dto|Payload|Response)\b/);
  }
});

test('Stock positions are an autonomous lazy context and no longer live in legacy', async () => {
  const appDirectory = join(root, 'src/web/app');
  const stockDirectory = join(root, 'src/web/features/stock');
  const routes = await readFile(join(appDirectory, 'app.routes.ts'), 'utf8');
  const stockRoutes = await readFile(join(stockDirectory, 'stock.routes.ts'), 'utf8');
  const store = await readFile(join(stockDirectory, 'application/stock-position-store.ts'), 'utf8');
  const page = await readFile(join(stockDirectory, 'presentation/stock-page.ts'), 'utf8');

  assert.match(routes, /features\/stock\/stock\.routes/);
  assert.match(stockRoutes, /loadComponent:[\s\S]*presentation\/stock-page/);
  assert.match(stockRoutes, /provide:\s*STOCK_GATEWAY,\s*useExisting:\s*HttpStockGateway/);
  await assert.rejects(readFile(join(appDirectory, 'stock-api.service.ts'), 'utf8'));
  assert.doesNotMatch(store, /HttpClient|\b\w+(Dto|Payload|Response)\b/);
  assert.match(store, /inject\(STOCK_GATEWAY\)/);
  assert.match(store, /switchMap/);
  assert.doesNotMatch(page, /HttpClient|\b\w+(Dto|Payload|Response)\b|\.\.\/domain|\.\.\/infrastructure/);
  assert.match(page, /StockPositionStore/);

  const layerSources = async (layer) => Promise.all(
    (await readdir(join(stockDirectory, layer), { recursive: true }))
      .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.spec.ts'))
      .map((entry) => readFile(join(stockDirectory, layer, entry), 'utf8')),
  );
  for (const source of await layerSources('domain')) {
    assert.doesNotMatch(source, /@angular|rxjs|HttpClient|Router|document\.|sessionStorage/);
  }
  for (const source of await layerSources('application')) {
    assert.doesNotMatch(source, /HttpClient|Router|sessionStorage|\b\w+(Dto|Payload|Response)\b/);
  }
  for (const source of await layerSources('presentation')) {
    assert.doesNotMatch(source, /HttpClient|\b\w+(Dto|Payload|Response)\b/);
  }
});

test('Stock Inventories are autonomous, route-scoped and absent from legacy', async () => {
  const appDirectory = join(root, 'src/web/app');
  const stockDirectory = join(root, 'src/web/features/stock');
  const routes = await readFile(join(appDirectory, 'app.routes.ts'), 'utf8');
  const stockRoutes = await readFile(join(stockDirectory, 'stock.routes.ts'), 'utf8');

  assert.match(routes, /features\/stock\/stock\.routes/);
  assert.match(stockRoutes, /path: 'inventaires'[\s\S]*providers:[\s\S]*InventoryStore[\s\S]*STOCK_GATEWAY[\s\S]*HttpStockGateway[\s\S]*LAST_INVENTORY_STORAGE[\s\S]*SessionLastInventoryStorage[\s\S]*loadComponent:[\s\S]*presentation\/inventory-page/);
  await assert.rejects(readFile(join(appDirectory, 'inventory-api.service.ts'), 'utf8'));
  await assert.rejects(readFile(join(appDirectory, 'stock-api.service.ts'), 'utf8'));

  const layerSources = async (layer) => Promise.all(
    (await readdir(join(stockDirectory, layer), { recursive: true }))
      .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.spec.ts'))
      .map((entry) => readFile(join(stockDirectory, layer, entry), 'utf8')),
  );
  for (const source of await layerSources('domain')) {
    assert.doesNotMatch(source, /@angular|rxjs|HttpClient|Router|document\.|sessionStorage/);
  }
  for (const source of await layerSources('application')) {
    assert.doesNotMatch(source, /HttpClient|Router|document\.|sessionStorage|\b\w+(Dto|Payload|Response)\b/);
  }
  for (const source of await layerSources('presentation')) {
    assert.doesNotMatch(source, /HttpClient|\b\w+(Dto|Payload|Response)\b|\.\.\/infrastructure/);
  }
});

test('Stock Approvisionnements are route-scoped and no longer live in legacy', async () => {
  const appDirectory = join(root, 'src/web/app');
  const stockDirectory = join(root, 'src/web/features/stock');
  const routes = await readFile(join(appDirectory, 'app.routes.ts'), 'utf8');
  const stockRoutes = await readFile(join(stockDirectory, 'stock.routes.ts'), 'utf8');
  const gateway = await readFile(join(stockDirectory, 'application/stock-gateway.ts'), 'utf8');
  const store = await readFile(join(stockDirectory, 'application/supply-store.ts'), 'utf8');
  const page = await readFile(join(stockDirectory, 'presentation/supply-page.ts'), 'utf8');

  assert.match(routes, /features\/stock\/stock\.routes/);
  assert.match(stockRoutes, /path: 'approvisionnements'[\s\S]*providers:[\s\S]*SupplyStore[\s\S]*STOCK_GATEWAY[\s\S]*HttpStockGateway[\s\S]*loadComponent:[\s\S]*presentation\/supply-page/);
  assert.match(gateway, /recordSupply/);
  assert.match(gateway, /recordBulkSupply/);
  assert.match(store, /inject\(STOCK_GATEWAY\)/);
  assert.doesNotMatch(store, /HttpClient|\b\w+(Dto|Payload|Response)\b/);
  assert.match(page, /@angular\/forms\/signals/);
  assert.match(page, /SupplyStore/);
  assert.doesNotMatch(page, /HttpClient|\b\w+(Dto|Payload|Response)\b|\.\.\/infrastructure/);
});

test('Stock corrections are autonomous, route-scoped and free of Sales imports', async () => {
  const appDirectory = join(root, 'src/web/app');
  const stockDirectory = join(root, 'src/web/features/stock');
  const routes = await readFile(join(appDirectory, 'app.routes.ts'), 'utf8');
  const stockRoutes = await readFile(join(stockDirectory, 'stock.routes.ts'), 'utf8');
  const files = (await readdir(stockDirectory, { recursive: true }))
    .filter((file) => file.endsWith('.ts'))
    .sort();
  const sources = await Promise.all(files.map((file) => readFile(join(stockDirectory, file), 'utf8')));

  assert.match(routes, /features\/stock\/stock\.routes/);
  assert.match(stockRoutes, /path: 'corrections'[\s\S]*providers:[\s\S]*CounterMovementStore[\s\S]*STOCK_GATEWAY[\s\S]*HttpStockGateway[\s\S]*loadComponent:[\s\S]*counter-movement-page/);
  await assert.rejects(readFile(join(appDirectory, 'counter-movement-api.service.ts'), 'utf8'));
  for (const source of sources) {
    assert.doesNotMatch(source, /(?:from\s+['"][^'"]*|import\s*\(['"][^'"]*)(?:sales|ventes)/i);
  }

  for (const [file, source] of files.map((file, index) => [file, sources[index]])) {
    if (file.endsWith('.spec.ts')) continue;
    if (file.startsWith('domain/')) {
      assert.doesNotMatch(source, /@angular|rxjs|HttpClient|Router|document|sessionStorage/);
    }
    if (file.startsWith('application/')) {
      assert.doesNotMatch(source, /HttpClient|Router|document|sessionStorage|\b\w+(Dto|Payload|Response)\b/);
    }
    if (file.startsWith('presentation/')) {
      assert.doesNotMatch(source, /HttpClient|\b\w+(Dto|Payload|Response)\b/);
    }
    if (file.startsWith('presentation/counter-movement')) {
      assert.doesNotMatch(source, /\.\.\/domain/);
    }
  }
});

test('Stock History is autonomous, route-scoped and no longer lives in legacy', async () => {
  const appDirectory = join(root, 'src/web/app');
  const stockDirectory = join(root, 'src/web/features/stock');
  const routes = await readFile(join(appDirectory, 'app.routes.ts'), 'utf8');
  const stockRoutes = await readFile(join(stockDirectory, 'stock.routes.ts'), 'utf8');
  const gateway = await readFile(join(stockDirectory, 'application/stock-gateway.ts'), 'utf8');
  const store = await readFile(join(stockDirectory, 'application/history-store.ts'), 'utf8');
  const page = await readFile(join(stockDirectory, 'presentation/history-page.ts'), 'utf8');

  assert.match(routes, /features\/stock\/stock\.routes/);
  assert.match(stockRoutes, /path: 'historique'[\s\S]*providers:[\s\S]*HistoryStore[\s\S]*STOCK_GATEWAY[\s\S]*HttpStockGateway[\s\S]*loadComponent:[\s\S]*presentation\/history-page/);
  assert.match(gateway, /history\(query: HistoryQuery\)/);
  assert.match(store, /inject\(STOCK_GATEWAY\)/);
  assert.match(store, /switchMap/);
  assert.doesNotMatch(store, /HttpClient|\b\w+(Dto|Payload|Response)\b/);
  assert.match(page, /HistoryStore/);
  assert.doesNotMatch(page, /HttpClient|\b\w+(Dto|Payload|Response)\b|\.\.\/domain|\.\.\/infrastructure/);
  await assert.rejects(readFile(join(appDirectory, 'history-api.service.ts'), 'utf8'));
});

test('the Sales context is autonomous and route-scoped', async () => {
  const appDirectory = join(root, 'src/web/app');
  const salesDirectory = join(root, 'src/web/features/sales');
  const routes = await readFile(join(appDirectory, 'app.routes.ts'), 'utf8');
  const salesRoutes = await readFile(join(salesDirectory, 'sales.routes.ts'), 'utf8');
  const salesFiles = (await readdir(salesDirectory, { recursive: true }))
    .filter((file) => file.endsWith('.ts'))
    .sort();
  const salesSources = await Promise.all(
    salesFiles.map((file) => readFile(join(salesDirectory, file), 'utf8')),
  );

  assert.match(routes, /features\/sales\/sales\.routes/);
  assert.match(salesRoutes, /providers:[\s\S]*SaleStore[\s\S]*SALES_GATEWAY[\s\S]*HttpSalesGateway[\s\S]*LAST_SALE_STORAGE[\s\S]*SessionLastSaleStorage[\s\S]*loadComponent:[\s\S]*presentation\/sales-page/);
  assert.ok(!salesFiles.includes('sales-api.service.ts'));
  for (const source of salesSources) {
    assert.doesNotMatch(source, /(?:from\s+['"][^'"]*|import\s*\(['"][^'"]*)(?:catalogue|stock|dashboard)/i);
  }

  for (const [file, source] of salesFiles.map((file, index) => [file, salesSources[index]])) {
    if (file.endsWith('.spec.ts')) continue;
    if (file.startsWith('domain/')) {
      assert.doesNotMatch(source, /@angular|rxjs|HttpClient|Router|document|sessionStorage/);
    }
    if (file.startsWith('application/')) {
      assert.doesNotMatch(source, /HttpClient|Router|document|sessionStorage|\bDto\b/);
    }
    if (file.startsWith('presentation/')) {
      assert.doesNotMatch(source, /HttpClient|\bDto\b/);
    }
  }

  const directSessionStorageUsers = salesFiles.filter((file, index) => (
    !file.endsWith('.spec.ts') && salesSources[index].includes('sessionStorage')
  ));
  assert.deepEqual(directSessionStorageUsers, ['infrastructure/session-last-sale-storage.ts']);
});

test('Dashboard stays lazy, route-scoped and isolated from writing contexts', async () => {
  const dashboardDirectory = join(root, 'src/web/features/dashboard');
  const walk = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) files.push(...await walk(path));
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) files.push(path);
    }
    return files;
  };
  const files = await walk(dashboardDirectory);
  const sources = await Promise.all(files.map(async (path) => ({ path, source: await readFile(path, 'utf8') })));

  for (const layer of ['domain', 'application', 'infrastructure', 'presentation']) {
    assert.ok(files.some((path) => path.includes(`/dashboard/${layer}/`)));
  }
  for (const { path, source } of sources) {
    const imports = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map((match) => match[1]);
    assert.ok(imports.every((dependency) => !/(?:^|\/)(?:catalogue|stock|sales)(?:\/|$)/.test(dependency)), path);
    assert.ok([...source.matchAll(/export (?:abstract class|class|interface|type|const|function|enum) /g)].length <= 1, path);
    if (path.includes('/domain/')) {
      assert.doesNotMatch(source, /@angular|rxjs|HttpClient|Router|document|sessionStorage/);
    }
    if (path.includes('/application/')) {
      assert.doesNotMatch(source, /HttpClient|Router|document|sessionStorage|\.dto/);
    }
    if (!path.includes('/infrastructure/')) {
      assert.doesNotMatch(source, /\b\w+(?:Dto|Response)\b/);
    }
  }

  const appFiles = await readdir(join(root, 'src/web/app'));
  assert.ok(!appFiles.includes('dashboard.component.ts'));
  assert.ok(!appFiles.includes('dashboard-api.service.ts'));

  const routes = await readFile(join(root, 'src/web/app/app.routes.ts'), 'utf8');
  const dashboardRoutes = await readFile(join(root, 'src/web/app/dashboard.routes.ts'), 'utf8');
  const store = await readFile(join(dashboardDirectory, 'application/dashboard-store.ts'), 'utf8');
  assert.match(routes, /path: 'dashboard'[\s\S]*loadChildren: \(\) => import\('\.\/dashboard\.routes'\)/);
  assert.match(dashboardRoutes, /providers:\s*\[[\s\S]*DashboardStore[\s\S]*DashboardGateway[\s\S]*DashboardHttpGateway/);
  assert.match(dashboardRoutes, /loadComponent: \(\) => import\('\.\.\/features\/dashboard\/presentation\/dashboard-page'\)/);
  assert.doesNotMatch(store, /providedIn/);
  assert.match(store, /switchMap/);
  assert.match(store, /takeUntilDestroyed/);
});

test('the final frontend has executable boundaries and no migration leftovers', async () => {
  const webRoot = join(root, 'src/web');
  const contexts = [
    { name: 'catalogue', directory: join(webRoot, 'features/catalogue') },
    { name: 'stock', directory: join(webRoot, 'features/stock') },
    { name: 'dashboard', directory: join(webRoot, 'features/dashboard') },
    { name: 'sales', directory: join(webRoot, 'features/sales') },
  ];
  const walk = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) files.push(...await walk(file));
      else files.push(file);
    }
    return files;
  };
  const allFiles = await walk(webRoot);
  const productionFiles = allFiles.filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'));
  const sources = await Promise.all(productionFiles.map(async (file) => ({
    file,
    source: await readFile(file, 'utf8'),
  })));

  assert.deepEqual(
    allFiles.filter((file) => /(?:^|\/)(?:models|types|utils|index)\.ts$|(?:-api\.service\.ts$)|(?:legacy|app\.component|dashboard\.component)/i.test(file)),
    [],
  );
  for (const { file, source } of sources) {
    assert.doesNotMatch(source, /LegacyBackofficePage|loadLegacy|legacy-backoffice-page|(?:Article|Stock|History|Sales|Dashboard)ApiService/);
    assert.ok(
      [...source.matchAll(/^\s*export\s+(?:(?:abstract|declare)\s+)?(?:class|interface|type|const|function|enum)\b/gm)].length <= 1,
      file,
    );
  }

  const layerDependencies = {
    domain: new Set(['domain']),
    application: new Set(['domain', 'application']),
    infrastructure: new Set(['domain', 'application', 'infrastructure']),
    presentation: new Set(['domain', 'application', 'presentation']),
  };
  const contextFor = (file) => contexts.find(({ directory }) => (
    file === directory || file.startsWith(`${directory}/`)
  ));
  const layerFor = (file, context) => {
    if (!context) return undefined;
    const path = relative(context.directory, file).replaceAll('\\', '/');
    return ['domain', 'application', 'infrastructure', 'presentation']
      .find((layer) => path.startsWith(`${layer}/`));
  };

  for (const { file, source } of sources) {
    const context = contextFor(file);
    const layer = layerFor(file, context);
    const imports = [
      ...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
      ...source.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm),
    ].map((match) => match[1]);
    for (const specifier of imports) {
      if (!specifier.startsWith('.') || !context) continue;
      const target = resolve(dirname(file), specifier);
      const targetContext = contextFor(target);
      if (targetContext && targetContext.name !== context.name) {
        assert.fail(`${file} imports another bounded context through ${specifier}`);
      }
      if (!layer || !targetContext) continue;
      const targetLayer = layerFor(target, targetContext);
      if (targetLayer) assert.ok(layerDependencies[layer].has(targetLayer), `${file} -> ${specifier}`);
    }

    if (!layer) continue;
    if (layer === 'domain') {
      assert.doesNotMatch(source, /@angular|rxjs|HttpClient|Router|document\.|sessionStorage/);
    }
    if (layer === 'application') {
      assert.doesNotMatch(source, /HttpClient|Router|document\.|sessionStorage|\b\w+(Dto|Payload|Response)\b/);
    }
    if (layer === 'presentation') {
      assert.doesNotMatch(source, /HttpClient|\b\w+(Dto|Payload|Response)\b|(?:^|[/'"])infrastructure(?:[/'"]|$)/);
    }
    if (layer !== 'infrastructure') {
      assert.doesNotMatch(source, /\b\w+(Dto|Payload|Response)\b/);
    }
  }

  const tsconfig = JSON.parse(await readFile(join(root, 'tsconfig.json'), 'utf8'));
  for (const option of [
    'verbatimModuleSyntax',
    'isolatedModules',
    'noUncheckedSideEffectImports',
    'noUncheckedIndexedAccess',
    'exactOptionalPropertyTypes',
    'noUnusedLocals',
    'noUnusedParameters',
  ]) {
    assert.equal(tsconfig.compilerOptions[option], true, `tsconfig compilerOptions.${option}`);
  }
  assert.equal(tsconfig.compilerOptions.moduleDetection, 'force');

  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.match(packageJson.devDependencies.typescript, /^6\.0\.\d+$/);
  const globalStyles = await readFile(join(webRoot, 'styles.css'), 'utf8');
  assert.doesNotMatch(globalStyles, /\.(?:catalog-filters|supply-form|supply-line|primary-link|stale-result|price-quote|dashboard-[\w-]+)/);
});
