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

@Injectable({ providedIn: 'root' })
export class StockApiService {
  private readonly http = inject(HttpClient);

  list(): Observable<StockPositionResponse[]> {
    return this.http.get<StockPositionResponse[]>('/api/stock');
  }

  getByEan13(ean13: string): Observable<StockPositionResponse> {
    return this.http.get<StockPositionResponse>(`/api/stock/${encodeURIComponent(ean13)}`);
  }
}
