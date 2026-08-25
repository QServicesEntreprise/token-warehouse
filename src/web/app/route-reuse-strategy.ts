import type { ActivatedRouteSnapshot, DetachedRouteHandle, RouteReuseStrategy } from '@angular/router';

let catalogueListHandle: DetachedRouteHandle | null = null;
let historyHandle: DetachedRouteHandle | null = null;

const isCatalogueListRoute = (route: ActivatedRouteSnapshot): boolean => (
  route.routeConfig?.path === ''
  && route.firstChild === null
  && route.pathFromRoot.some((snapshot) => snapshot.routeConfig?.path === 'catalogue')
);

const isHistoryRoute = (route: ActivatedRouteSnapshot): boolean => (
  route.routeConfig?.path === 'historique'
  && route.pathFromRoot.some((snapshot) => snapshot.routeConfig?.path === 'stock')
);

export const appRouteReuseStrategy: RouteReuseStrategy = {
  shouldDetach: (route) => isCatalogueListRoute(route) || isHistoryRoute(route),
  store: (route, handle) => {
    if (isCatalogueListRoute(route)) catalogueListHandle = handle;
    if (isHistoryRoute(route)) historyHandle = handle;
  },
  shouldAttach: (route) => isCatalogueListRoute(route)
    ? catalogueListHandle !== null
    : isHistoryRoute(route) && historyHandle !== null,
  retrieve: (route) => isCatalogueListRoute(route)
    ? catalogueListHandle
    : isHistoryRoute(route) ? historyHandle : null,
  shouldReuseRoute: (future, current) => future.routeConfig === current.routeConfig,
};
