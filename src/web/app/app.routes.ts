import type { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'catalogue' },
  {
    path: 'dashboard',
    loadChildren: () => import('./dashboard.routes').then(({ dashboardRoutes }) => dashboardRoutes),
  },
  {
    path: 'catalogue',
    loadChildren: () => import('../features/catalogue/catalogue.routes').then(({ CATALOGUE_ROUTES }) => CATALOGUE_ROUTES),
  },
  {
    path: 'stock',
    loadChildren: () => import('../features/stock/stock.routes').then(({ STOCK_ROUTES }) => STOCK_ROUTES),
  },
  {
    path: 'ventes',
    loadChildren: () => import('../features/sales/sales.routes').then(({ SALES_ROUTES }) => SALES_ROUTES),
  },
  { path: '**', redirectTo: 'catalogue' },
];
