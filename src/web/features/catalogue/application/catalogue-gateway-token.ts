import { InjectionToken } from '@angular/core';
import type { CatalogueGateway } from './catalogue-gateway';

export const CATALOGUE_GATEWAY = new InjectionToken<CatalogueGateway>('CATALOGUE_GATEWAY');
