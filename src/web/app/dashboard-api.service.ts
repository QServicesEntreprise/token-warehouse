import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { StockAvailability, StockReason } from './stock-api.service';

export type DashboardArticleType = 'food' | 'nonFood';
export type DashboardLifecycleStatus = 'ACTIVE' | 'ARCHIVED';

export interface DashboardStockLineResponse {
  ean13: string;
  name: string;
  articleType: DashboardArticleType;
  lifecycleStatus: DashboardLifecycleStatus;
  physicalStock: number;
  sellableStock: number;
  nonSellableStock: number;
  availability: StockAvailability;
  reason: StockReason | null;
}

export interface DashboardResponse {
  kpis: {
    physicalStock: number;
    sellableStock: number;
    nonSellableStock: number;
  };
  alerts: {
    outOfStock: DashboardStockLineResponse[];
    notSellable: DashboardStockLineResponse[];
  };
  stockByArticle: DashboardStockLineResponse[];
}

@Injectable({ providedIn: 'root' })
export class DashboardApiService {
  private readonly http = inject(HttpClient);

  getCurrent(): Observable<DashboardResponse> {
    return this.http.get<DashboardResponse>('/api/dashboard');
  }
}
