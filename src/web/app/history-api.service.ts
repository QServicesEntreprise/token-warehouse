import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export type HistoryEntryType =
  | 'SUPPLY'
  | 'INVENTORY'
  | 'SALE_STOCK'
  | 'COUNTER_MOVEMENT'
  | 'CATALOG_ARCHIVE'
  | 'CATALOG_REACTIVATE'
  | 'CATALOG_DLC_CHANGE'
  | 'CATALOG_PACKAGING_CHANGE'
  | 'CATALOG_ATTRIBUTE_CHANGE';

export interface HistoryArticleResponse {
  ean13: string;
}

export interface HistoryLineResponse {
  lineNumber: number;
  ean13: string;
  quantity?: number;
  previousPhysicalStock?: number;
  countedQuantity?: number;
  difference?: number;
  stockEffect?: number;
  inverseEffect?: number;
  resultingPhysicalStock?: number;
}

export interface HistoryChangeResponse {
  field: string;
  before?: string;
  after?: string;
  previousValue?: string;
  nextValue?: string;
}

export interface HistoryEntryResponse {
  id: string;
  type: HistoryEntryType;
  timestampUtc: string;
  ean13: string;
  articles: HistoryArticleResponse[];
  quantity?: number;
  stockEffect?: number;
  previousPhysicalStock?: number;
  countedQuantity?: number;
  difference?: number;
  resultingPhysicalStock?: number;
  lines: HistoryLineResponse[];
  sourceOperationId?: string;
  sourceOperationType?: string;
  justification?: string;
  correctedByOperationId?: string;
  correctionOperationId?: string;
  previousStatus?: string;
  nextStatus?: string;
  kind?: string;
  changes?: HistoryChangeResponse[];
}

@Injectable({ providedIn: 'root' })
export class HistoryApiService {
  private readonly http = inject(HttpClient);

  list(ean13?: string): Observable<HistoryEntryResponse[]> {
    let params = new HttpParams();
    if (ean13 !== undefined) {
      params = params.set('ean13', ean13);
    }
    return this.http.get<HistoryEntryResponse[]>('/api/history', { params });
  }
}
