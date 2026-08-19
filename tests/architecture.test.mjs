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
    'Microsoft.EntityFrameworkCore.Design',
    'Microsoft.EntityFrameworkCore.Sqlite',
    'Microsoft.Extensions.DependencyInjection.Abstractions',
    'Microsoft.Extensions.Hosting.Abstractions',
  ].sort());
  assert.deepEqual(await packageReferences('src/backend/TokenWarehouse.Api/TokenWarehouse.Api.csproj'), [
    'Microsoft.EntityFrameworkCore.Design',
  ]);
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
