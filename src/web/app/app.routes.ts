import { ActivatedRouteSnapshot, DetachedRouteHandle, RouteReuseStrategy, Routes } from '@angular/router';

const loadLegacy = () => import('./legacy-backoffice-page').then((module) => module.LegacyBackofficePage);

let legacyHandle: DetachedRouteHandle | null = null;
let catalogueListHandle: DetachedRouteHandle | null = null;

const isLegacyRoute = (route: ActivatedRouteSnapshot): boolean => (
  route.routeConfig?.loadComponent === loadLegacy
);

const isCatalogueListRoute = (route: ActivatedRouteSnapshot): boolean => (
  route.routeConfig?.path === ''
  && route.firstChild === null
  && route.pathFromRoot.some((snapshot) => snapshot.routeConfig?.path === 'catalogue')
);

export const legacyRouteReuseStrategy: RouteReuseStrategy = {
  // ponytail: one shared legacy handle preserves form state until RF-10 removes the strangler.
  shouldDetach: (route) => isLegacyRoute(route) || isCatalogueListRoute(route),
  store: (route, handle) => {
    if (isCatalogueListRoute(route)) catalogueListHandle = handle;
    else legacyHandle = handle;
  },
  shouldAttach: (route) => isCatalogueListRoute(route)
    ? catalogueListHandle !== null
    : isLegacyRoute(route) && legacyHandle !== null,
  retrieve: (route) => isCatalogueListRoute(route)
    ? catalogueListHandle
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
    data: { section: 'dashboard' },
    loadComponent: loadLegacy,
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
        data: { section: 'stock' },
        loadComponent: loadLegacy,
      },
      {
        path: 'approvisionnements',
        data: { section: 'approvisionnements' },
        loadComponent: loadLegacy,
      },
      {
        path: 'inventaires',
        data: { section: 'inventaires' },
        loadComponent: loadLegacy,
      },
      {
        path: 'corrections',
        data: { section: 'corrections' },
        loadComponent: loadLegacy,
      },
      {
        path: 'historique',
        data: { section: 'historique' },
        loadComponent: loadLegacy,
      },
    ],
  },
  {
    path: 'ventes',
    data: { section: 'ventes' },
    loadComponent: loadLegacy,
  },
  { path: '**', redirectTo: 'dashboard' },
];
