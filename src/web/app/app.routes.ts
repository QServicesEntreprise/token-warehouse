import { ActivatedRouteSnapshot, DetachedRouteHandle, RouteReuseStrategy, Routes } from '@angular/router';
import { STOCK_GATEWAY } from '../features/stock/application/stock-gateway-token';
import { CounterMovementStore } from '../features/stock/application/counter-movement-store';
import { InventoryStore } from '../features/stock/application/inventory-store';
import { LAST_INVENTORY_STORAGE } from '../features/stock/application/last-inventory-storage-token';
import { HistoryStore } from '../features/stock/application/history-store';
import { StockPositionStore } from '../features/stock/application/stock-position-store';
import { SupplyStore } from '../features/stock/application/supply-store';
import { HttpStockGateway } from '../features/stock/infrastructure/http-stock-gateway';
import { SessionLastInventoryStorage } from '../features/stock/infrastructure/session-last-inventory-storage';
import { LAST_SALE_STORAGE } from './features/sales/application/last-sale-storage.token';
import { SaleStore } from './features/sales/application/sale-store';
import { SALES_GATEWAY } from './features/sales/application/sales-gateway.token';
import { HttpSalesGateway } from './features/sales/infrastructure/http-sales-gateway';
import { SessionLastSaleStorage } from './features/sales/infrastructure/session-last-sale-storage';

const loadLegacy = () => import('./legacy-backoffice-page').then((module) => module.LegacyBackofficePage);

let legacyHandle: DetachedRouteHandle | null = null;
let catalogueListHandle: DetachedRouteHandle | null = null;
let historyHandle: DetachedRouteHandle | null = null;

const isLegacyRoute = (route: ActivatedRouteSnapshot): boolean => (
  route.routeConfig?.loadComponent === loadLegacy
);

const isCatalogueListRoute = (route: ActivatedRouteSnapshot): boolean => (
  route.routeConfig?.path === ''
  && route.firstChild === null
  && route.pathFromRoot.some((snapshot) => snapshot.routeConfig?.path === 'catalogue')
);

const isHistoryRoute = (route: ActivatedRouteSnapshot): boolean => (
  route.routeConfig?.path === 'historique'
  && route.pathFromRoot.some((snapshot) => snapshot.routeConfig?.path === 'stock')
);

export const legacyRouteReuseStrategy: RouteReuseStrategy = {
  // ponytail: detached handles preserve in-progress forms until the strangler is removed.
  shouldDetach: (route) => isLegacyRoute(route) || isCatalogueListRoute(route) || isHistoryRoute(route),
  store: (route, handle) => {
    if (isCatalogueListRoute(route)) catalogueListHandle = handle;
    else if (isHistoryRoute(route)) historyHandle = handle;
    else legacyHandle = handle;
  },
  shouldAttach: (route) => isCatalogueListRoute(route)
    ? catalogueListHandle !== null
    : isHistoryRoute(route)
      ? historyHandle !== null
    : isLegacyRoute(route) && legacyHandle !== null,
  retrieve: (route) => isCatalogueListRoute(route)
    ? catalogueListHandle
    : isHistoryRoute(route)
      ? historyHandle
    : isLegacyRoute(route) ? legacyHandle : null,
  shouldReuseRoute: (future, current) => (
    future.routeConfig === current.routeConfig
    || (isLegacyRoute(future) && isLegacyRoute(current))
  ),
};

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'dashboard',
    loadChildren: () => import('./dashboard.routes').then(module => module.dashboardRoutes),
  },
  {
    path: 'catalogue',
    loadChildren: () => import('../features/catalogue/catalogue.routes').then((module) => module.CATALOGUE_ROUTES),
  },
  {
    path: 'stock',
    children: [
      {
        path: '',
        pathMatch: 'full',
        providers: [
          HttpStockGateway,
          StockPositionStore,
          { provide: STOCK_GATEWAY, useExisting: HttpStockGateway },
        ],
        loadComponent: () => import('../features/stock/presentation/stock-page').then((module) => module.StockPage),
      },
      {
        path: 'approvisionnements',
        data: { section: 'approvisionnements' },
        providers: [
          HttpStockGateway,
          SupplyStore,
          { provide: STOCK_GATEWAY, useExisting: HttpStockGateway },
        ],
        loadComponent: () => import('../features/stock/presentation/supply-page').then((module) => module.SupplyPage),
      },
      {
        path: 'inventaires',
        providers: [
          InventoryStore,
          { provide: STOCK_GATEWAY, useClass: HttpStockGateway },
          { provide: LAST_INVENTORY_STORAGE, useClass: SessionLastInventoryStorage },
        ],
        loadComponent: () => import('../features/stock/presentation/inventory-page').then((module) => module.InventoryPage),
      },
      {
        path: 'corrections',
        providers: [
          HttpStockGateway,
          CounterMovementStore,
          { provide: STOCK_GATEWAY, useExisting: HttpStockGateway },
        ],
        loadComponent: () => import('../features/stock/presentation/counter-movement-page').then((module) => module.CounterMovementPage),
      },
      {
        path: 'historique',
        providers: [
          HistoryStore,
          { provide: STOCK_GATEWAY, useClass: HttpStockGateway },
        ],
        loadComponent: () => import('../features/stock/presentation/history-page').then((module) => module.HistoryPage),
      },
    ],
  },
  {
    path: 'ventes',
    data: { section: 'ventes' },
    providers: [
      SaleStore,
      { provide: SALES_GATEWAY, useClass: HttpSalesGateway },
      { provide: LAST_SALE_STORAGE, useClass: SessionLastSaleStorage },
    ],
    loadComponent: () => import('./features/sales/presentation/sales-page').then((module) => module.SalesPage),
  },
  { path: '**', redirectTo: 'dashboard' },
];
