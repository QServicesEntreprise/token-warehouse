import { Routes } from '@angular/router';
import { ArticleCreateStore } from './application/article-create-store';
import { ArticleDetailsStore } from './application/article-details-store';
import { CATALOGUE_GATEWAY } from './application/catalogue-gateway-token';
import { CatalogueListStore } from './application/catalogue-list-store';
import { HttpCatalogueGateway } from './infrastructure/http-catalogue-gateway';

const gatewayProvider = { provide: CATALOGUE_GATEWAY, useClass: HttpCatalogueGateway };

export const CATALOGUE_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    providers: [CatalogueListStore, gatewayProvider],
    loadComponent: () => import('./presentation/catalogue-list-page').then((module) => module.CatalogueListPage),
  },
  {
    path: 'nouveau',
    providers: [ArticleCreateStore, gatewayProvider],
    loadComponent: () => import('./presentation/article-create-page').then((module) => module.ArticleCreatePage),
  },
  {
    path: ':ean13',
    providers: [ArticleDetailsStore, gatewayProvider],
    loadComponent: () => import('./presentation/article-details-page').then((module) => module.ArticleDetailsPage),
  },
];
