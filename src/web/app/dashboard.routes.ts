import type { Routes } from '@angular/router';
import { DashboardGateway } from '../features/dashboard/application/dashboard-gateway';
import { DashboardStore } from '../features/dashboard/application/dashboard-store';
import { DashboardHttpGateway } from '../features/dashboard/infrastructure/dashboard-http-gateway';

export const dashboardRoutes: Routes = [{
  path: '',
  title: 'Dashboard · Token Warehouse',
  providers: [
    DashboardStore,
    { provide: DashboardGateway, useClass: DashboardHttpGateway },
  ],
  loadComponent: () => import('../features/dashboard/presentation/dashboard-page')
    .then(module => module.DashboardPage),
}];
