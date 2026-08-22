import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { StockAvailability, StockReason } from './stock-api.service';

export type DashboardArticleType = 'food' | 'nonFood';
export type DashboardLifecycleStatus = 'ACTIVE' | 'ARCHIVED';
export type DashboardConsumptionMode = 'takeaway' | 'onsite';
export type DashboardPackaging = 'new' | 'refurbished' | 'unsellable';

export interface DashboardQuery {
  from: string;
  to: string;
  type: DashboardArticleType | null;
  mode: DashboardConsumptionMode | null;
  packaging: DashboardPackaging | null;
}

export interface DashboardCalendarResponse {
  status: 'ok';
  provider: string;
  warehouseDate: string;
  currentMonth: {
    from: string;
    to: string;
  };
}

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

export interface DashboardFlowDayResponse {
  date: string;
  supplies: number;
  sales: number;
}

export interface DashboardTaxRateSummaryResponse {
  taxRate: {
    code: 'takeaway' | 'onsite' | 'nonFood';
    ratio: string;
    numerator: number;
    denominator: number;
  };
  amountHtCents: number;
  vatCents: number;
  amountTtcCents: number;
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
  flowsByDay: DashboardFlowDayResponse[];
  financial: {
    revenueHtCents: number;
    revenueTtcCents: number;
    vatCollectedCents: number;
    byTaxRate: DashboardTaxRateSummaryResponse[];
  };
}

@Injectable({ providedIn: 'root' })
export class DashboardApiService {
  private readonly http = inject(HttpClient);

  getCalendar(): Observable<DashboardCalendarResponse> {
    return this.http.get<DashboardCalendarResponse>('/health');
  }

  getCurrent(query: DashboardQuery): Observable<DashboardResponse> {
    let params = new HttpParams()
      .set('from', query.from)
      .set('to', query.to);
    if (query.type !== null) {
      params = params.set('type', query.type);
    }
    if (query.mode !== null) {
      params = params.set('mode', query.mode);
    }
    if (query.packaging !== null) {
      params = params.set('packaging', query.packaging);
    }

    return this.http.get<DashboardResponse>('/api/dashboard', { params });
  }
}
