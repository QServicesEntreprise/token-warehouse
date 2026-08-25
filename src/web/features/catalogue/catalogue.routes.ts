import type { Routes } from '@angular/router';
import { ArticleCreateStore } from './application/article-create-store';
import { ArticleDetailsStore } from './application/article-details-store';
import { CATALOGUE_GATEWAY } from './application/catalogue-gateway-token';
import { CatalogueListStore } from './application/catalogue-list-store';
import { HttpCatalogueGateway } from './infrastructure/http-catalogue-gateway';

const gatewayProvider = { provide: CATALOGUE_GATEWAY, useClass: HttpCatalogueGateway };

export const CATALOGUE_ROUTES: Routes = [
  {
    path: '',
    providers: [CatalogueListStore, gatewayProvider],
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () => import('./presentation/catalogue-list-page').then((module) => module.CatalogueListPage),
      },
      {
        path: 'nouveau',
        providers: [ArticleCreateStore],
        loadComponent: () => import('./presentation/article-create-page').then((module) => module.ArticleCreatePage),
      },
      {
        path: ':ean13',
        providers: [ArticleDetailsStore],
        loadComponent: () => import('./presentation/article-details-page').then((module) => module.ArticleDetailsPage),
      },
    ],
  },
];
