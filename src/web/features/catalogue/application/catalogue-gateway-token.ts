import { InjectionToken } from '@angular/core';
import { CatalogueGateway } from './catalogue-gateway';

export const CATALOGUE_GATEWAY = new InjectionToken<CatalogueGateway>('CATALOGUE_GATEWAY');
