import type { Routes } from '@angular/router';
import { CounterMovementStore } from './application/counter-movement-store';
import { HistoryStore } from './application/history-store';
import { InventoryStore } from './application/inventory-store';
import { LAST_INVENTORY_STORAGE } from './application/last-inventory-storage-token';
import { STOCK_GATEWAY } from './application/stock-gateway-token';
import { StockPositionStore } from './application/stock-position-store';
import { SupplyStore } from './application/supply-store';
import { HttpStockGateway } from './infrastructure/http-stock-gateway';
import { SessionLastInventoryStorage } from './infrastructure/session-last-inventory-storage';

export const STOCK_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Stock courant · Token Warehouse',
    providers: [
      HttpStockGateway,
      StockPositionStore,
      { provide: STOCK_GATEWAY, useExisting: HttpStockGateway },
    ],
    loadComponent: () => import('./presentation/stock-page').then(({ StockPage }) => StockPage),
  },
  {
    path: 'approvisionnements',
    title: 'Approvisionnement · Token Warehouse',
    data: { section: 'approvisionnements' },
    providers: [
      HttpStockGateway,
      SupplyStore,
      { provide: STOCK_GATEWAY, useExisting: HttpStockGateway },
    ],
    loadComponent: () => import('./presentation/supply-page').then(({ SupplyPage }) => SupplyPage),
  },
  {
    path: 'inventaires',
    title: 'Inventaire · Token Warehouse',
    providers: [
      InventoryStore,
      StockPositionStore,
      { provide: STOCK_GATEWAY, useClass: HttpStockGateway },
      { provide: LAST_INVENTORY_STORAGE, useClass: SessionLastInventoryStorage },
    ],
    loadComponent: () => import('./presentation/inventory-page').then(({ InventoryPage }) => InventoryPage),
  },
  {
    path: 'corrections',
    title: 'Contre-mouvement · Token Warehouse',
    providers: [
      HttpStockGateway,
      CounterMovementStore,
      { provide: STOCK_GATEWAY, useExisting: HttpStockGateway },
    ],
    loadComponent: () => import('./presentation/counter-movement-page').then(({ CounterMovementPage }) => CounterMovementPage),
  },
  {
    path: 'historique',
    title: 'Historique · Token Warehouse',
    providers: [
      HistoryStore,
      { provide: STOCK_GATEWAY, useClass: HttpStockGateway },
    ],
    loadComponent: () => import('./presentation/history-page').then(({ HistoryPage }) => HistoryPage),
  },
];
