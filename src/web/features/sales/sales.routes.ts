import type { Routes } from '@angular/router';
import { LAST_SALE_STORAGE } from './application/last-sale-storage.token';
import { SaleStore } from './application/sale-store';
import { SALES_GATEWAY } from './application/sales-gateway.token';
import { HttpSalesGateway } from './infrastructure/http-sales-gateway';
import { SessionLastSaleStorage } from './infrastructure/session-last-sale-storage';

export const SALES_ROUTES: Routes = [{
  path: '',
  title: 'Vente · Token Warehouse',
  data: { section: 'ventes' },
  providers: [
    SaleStore,
    { provide: SALES_GATEWAY, useClass: HttpSalesGateway },
    { provide: LAST_SALE_STORAGE, useClass: SessionLastSaleStorage },
  ],
  loadComponent: () => import('./presentation/sales-page').then(({ SalesPage }) => SalesPage),
}];
