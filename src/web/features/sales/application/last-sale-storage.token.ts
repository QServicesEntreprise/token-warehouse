import { InjectionToken } from '@angular/core';
import type { LastSaleStorage } from './last-sale-storage';

export const LAST_SALE_STORAGE = new InjectionToken<LastSaleStorage>('LAST_SALE_STORAGE');
