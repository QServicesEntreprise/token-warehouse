import { beforeEach, describe, expect, it } from 'vitest';
import { SessionLastInventoryStorage } from './session-last-inventory-storage';

describe('SessionLastInventoryStorage', () => {
  beforeEach(() => sessionStorage.clear());

  it('keeps the last committed Inventory id for a page reload', () => {
    const storage = new SessionLastInventoryStorage();

    storage.save('inventory-1');

    expect(storage.load()).toBe('inventory-1');
  });
});
