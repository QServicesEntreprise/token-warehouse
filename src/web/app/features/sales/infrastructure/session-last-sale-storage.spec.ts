import { afterEach, describe, expect, it } from 'vitest';
import { SessionLastSaleStorage } from './session-last-sale-storage';

describe('SessionLastSaleStorage', () => {
  afterEach(() => sessionStorage.clear());

  it('restores the last committed Sale identifier through the storage port', () => {
    const storage = new SessionLastSaleStorage();

    storage.save('sale-42');

    expect(storage.load()).toBe('sale-42');
  });
});
