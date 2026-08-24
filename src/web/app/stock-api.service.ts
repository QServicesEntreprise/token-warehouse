import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export type StockAvailability = 'AVAILABLE' | 'OUT_OF_STOCK' | 'NOT_SELLABLE';
export type StockReason = 'ARCHIVED' | 'DLC_EXPIRED' | 'UNSELLABLE_PACKAGING';

export interface StockPositionResponse {
  ean13: string;
  name: string;
  type: 'food' | 'nonFood';
  isActive: boolean;
  status: 'active' | 'archived';
  physicalQuantity: number;
  sellableQuantity: number;
  availability: StockAvailability;
  reason: StockReason | null;
  dlc?: string;
  consumptionModes?: ('takeaway' | 'onsite')[];
  packaging?: 'new' | 'refurbished' | 'unsellable';
}

export interface SupplyPayload {
  ean13: string;
  quantity: number | string | null;
}

export interface BulkSupplyPayload {
  lines: SupplyPayload[];
}

export interface SupplyOperationResponse {
  id: string;
  type: 'supply';
  ean13: string;
  quantity: number;
  occurredAt: string;
}

export interface SupplyResponse {
  operation: SupplyOperationResponse;
  position: StockPositionResponse;
}

export interface BulkSupplyLineResponse {
  lineNumber: number;
  ean13: string;
  quantity: number;
}

export interface BulkSupplyResponse {
  operation: {
    id: string;
    type: 'supply';
    occurredAt: string;
    lines: BulkSupplyLineResponse[];
  };
  positions: StockPositionResponse[];
}

@Injectable({ providedIn: 'root' })
export class StockApiService {
  private readonly http = inject(HttpClient);

  getByEan13(ean13: string): Observable<StockPositionResponse> {
    return this.http.get<StockPositionResponse>(`/api/stock/${encodeURIComponent(ean13)}`);
  }

  recordSupply(payload: SupplyPayload): Observable<SupplyResponse> {
    return this.http.post<SupplyResponse>('/api/supplies', payload);
  }

  recordBulkSupply(payload: BulkSupplyPayload): Observable<BulkSupplyResponse> {
    return this.http.post<BulkSupplyResponse>('/api/supplies/bulk', payload);
  }
}
