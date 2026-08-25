import { Injectable } from '@angular/core';
import type { LastSaleStorage } from '../application/last-sale-storage';

const storageKey = 'token-warehouse.last-sale-id';

@Injectable()
export class SessionLastSaleStorage implements LastSaleStorage {
  load(): string | null {
    try {
      return sessionStorage.getItem(storageKey);
    } catch {
      return null;
    }
  }

  save(operationId: string): void {
    try {
      sessionStorage.setItem(storageKey, operationId);
    } catch {
      // A committed Sale remains valid when browser storage is unavailable.
    }
  }
}
