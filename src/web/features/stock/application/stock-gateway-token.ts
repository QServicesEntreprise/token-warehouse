import { InjectionToken } from '@angular/core';
import type { StockGateway } from './stock-gateway';

export const STOCK_GATEWAY = new InjectionToken<StockGateway>('STOCK_GATEWAY');
