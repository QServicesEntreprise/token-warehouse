import { InjectionToken } from '@angular/core';
import { StockGateway } from './stock-gateway';

export const STOCK_GATEWAY = new InjectionToken<StockGateway>('STOCK_GATEWAY');
