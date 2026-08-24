import { InjectionToken } from '@angular/core';
import { SalesGateway } from './sales-gateway';

export const SALES_GATEWAY = new InjectionToken<SalesGateway>('SALES_GATEWAY');
