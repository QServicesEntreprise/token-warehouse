import { Injectable } from '@angular/core';
import type { LastInventoryStorage } from '../application/last-inventory-storage';

const storageKey = 'token-warehouse.last-inventory-id';

@Injectable()
export class SessionLastInventoryStorage implements LastInventoryStorage {
  load(): string | null {
    try {
      return sessionStorage.getItem(storageKey);
    } catch {
      return null;
    }
  }

  save(id: string): void {
    try {
      sessionStorage.setItem(storageKey, id);
    } catch {
      // A committed Inventory remains valid when browser storage is unavailable.
    }
  }
}
