import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import { expect, test as base } from '@playwright/test';

type E2eFixtures = {
  databaseIsolation: void;
};

const databasePath = process.env['TOKEN_WAREHOUSE_E2E_DATABASE_PATH'];
const lockPath = process.env['TOKEN_WAREHOUSE_E2E_LOCK_PATH'];

if (!databasePath || !lockPath) {
  throw new Error('Playwright E2E database paths are not configured.');
}

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// ponytail: one lock serializes the shared SQLite E2E fixture; split per-worker databases if the suite grows.
async function acquireDatabaseLock(): Promise<() => Promise<void>> {
  for (;;) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      await handle.writeFile(`${process.pid}\n`);
      return async () => {
        await handle.close();
        await fs.rm(lockPath, { force: true });
      };
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) {
        throw error;
      }
      await delay(25);
    }
  }
}

function resetDatabase(): void {
  const database = new DatabaseSync(databasePath);

  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      BEGIN;
      DELETE FROM StockOperations;
      DELETE FROM StockPositions;
      DELETE FROM ArticleLifecycleHistory;
      DELETE FROM Articles;
    `);

    const insertArticle = database.prepare(`
      INSERT INTO Articles
        (Ean13, Type, Name, NameSearchKey, PriceHtCents, IsActive, Version, Dlc, ConsumptionModes, Packaging)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `);
    const insertPosition = database.prepare(
      'INSERT INTO StockPositions (Ean13, PhysicalQuantity, Version) VALUES (?, ?, 0)',
    );

    const articles = [
      ['5901234123457', 'food', 'Biscuit historique', 299, 0, '2026-12-31', 'takeaway', null, 4],
      ['5012345678900', 'nonFood', 'Lampe historique', 2900, 0, null, null, 'refurbished', 4],
      ['0123456789012', 'food', 'DLC de démonstration', 100, 1, '2030-01-15', 'takeaway,onsite', null, 8],
      ['4012345678901', 'nonFood', 'Packaging de démonstration', 200, 1, null, null, 'new', 7],
      ['7351353713578', 'food', 'Inventaire de démonstration', 100, 1, '2030-01-15', 'takeaway', null, 8],
      ['1234567890128', 'food', 'Alimentaire expiré', 100, 1, '2020-01-14', 'takeaway', null, 7],
      ['0360002914522', 'food', 'Article sans position', 100, 1, '2099-01-15', 'takeaway', null, null],
      ['9876543210982', 'nonFood', 'Article vendable', 100, 1, null, null, 'new', 8],
      ['1111111111116', 'nonFood', 'Packaging invendable', 100, 1, null, null, 'unsellable', 3],
    ] as const;

    for (const [ean13, type, name, priceHtCents, isActive, dlc, consumptionModes, packaging, physicalQuantity] of articles) {
      insertArticle.run(
        ean13,
        type,
        name,
        name.normalize('NFC').toUpperCase(),
        priceHtCents,
        isActive,
        dlc,
        consumptionModes,
        packaging,
      );
      if (physicalQuantity !== null) {
        insertPosition.run(ean13, physicalQuantity);
      }
    }

    database.exec('COMMIT;');
  } catch (error) {
    try {
      database.exec('ROLLBACK;');
    } catch {
      // The original failure is the useful one.
    }
    throw error;
  } finally {
    database.close();
  }
}

export const test = base.extend<E2eFixtures>({
  databaseIsolation: [async ({}, use) => {
    const release = await acquireDatabaseLock();
    try {
      resetDatabase();
      await use();
    } finally {
      await release();
    }
  }, { auto: true }],
});

export { expect };
