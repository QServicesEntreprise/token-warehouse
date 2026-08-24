import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { SalePriceQuote } from '../features/sales/domain/sale-price-quote';
import { ConsumptionMode } from '../shared-kernel/consumption-mode';
import { StockAvailability, StockPositionResponse, StockReason } from './stock-api.service';

export interface SaleArticleResponse {
  ean13: string;
  name: string;
  type: 'food' | 'nonFood';
  isActive: boolean;
  status: 'active' | 'archived';
  priceHtCents: number;
  physicalQuantity: number;
  sellableQuantity: number;
  availability: StockAvailability;
  reason: StockReason | null;
  priceQuotes?: SalePriceQuote[];
  dlc?: string;
  consumptionModes?: ConsumptionMode[];
  packaging?: 'new' | 'refurbished' | 'unsellable';
}

export interface SaleOperationResponse {
  id: string;
  type: 'SALE';
  ean13: string;
  quantity: number;
  occurredAt: string;
}

export interface SaleFinancialResponse {
  context: 'takeaway' | 'onsite' | null;
  unitPriceHtCents: number;
  taxRate: {
    code: string;
    ratio: string;
    numerator: number;
    denominator: number;
  };
  amountHtCents: number;
  vatCents: number;
  amountTtcCents: number;
}

export interface SaleResponse {
  operation: SaleOperationResponse;
  financial: SaleFinancialResponse;
  position: StockPositionResponse;
}

export interface SalePayload {
  ean13: string;
  quantity: number;
  context?: ConsumptionMode;
}

@Injectable({ providedIn: 'root' })
export class SalesApiService {
  private readonly http = inject(HttpClient);

  searchArticles(search: string): Observable<SaleArticleResponse[]> {
    const trimmed = search.trim();
    const params = trimmed ? new HttpParams().set('search', trimmed) : undefined;
    return this.http.get<SaleArticleResponse[]>('/api/sales/articles', { params });
  }

  record(payload: SalePayload): Observable<SaleResponse> {
    return this.http.post<SaleResponse>('/api/sales', payload);
  }

  getById(operationId: string): Observable<SaleResponse> {
    return this.http.get<SaleResponse>(`/api/sales/${encodeURIComponent(operationId)}`);
  }
}
