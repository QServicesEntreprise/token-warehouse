import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface InventoryRequest {
  ean13: string;
  countedQuantity: number;
}

export interface BulkInventoryRequest {
  lines: InventoryRequest[];
}

export interface InventoryOperationResponse {
  id: string;
  type: 'INVENTORY';
  ean13: string;
  previousPhysicalStock: number;
  countedQuantity: number;
  inventoryDifference: number;
  resultingPhysicalStock: number;
  timestampUtc: string;
  lines?: InventoryOperationLineResponse[];
}

export interface InventoryOperationLineResponse {
  lineNumber: number;
  ean13: string;
  previousPhysicalStock: number;
  countedQuantity: number;
  inventoryDifference: number;
  resultingPhysicalStock: number;
  position?: InventoryPositionResponse;
}

export interface InventoryPositionResponse {
  ean13: string;
  physicalStock: number;
  sellableStock: number;
  availability: 'AVAILABLE' | 'OUT_OF_STOCK' | 'NOT_SELLABLE';
  reason: 'ARCHIVED' | 'DLC_EXPIRED' | 'UNSELLABLE_PACKAGING' | null;
}

export interface InventoryResponse {
  operation: InventoryOperationResponse;
  position: InventoryPositionResponse;
}

export interface BulkInventoryOperationResponse {
  id: string;
  type: 'INVENTORY';
  timestampUtc: string;
  lines: (InventoryOperationLineResponse & { position: InventoryPositionResponse })[];
  ean13?: string;
  previousPhysicalStock?: number;
  countedQuantity?: number;
  inventoryDifference?: number;
  resultingPhysicalStock?: number;
}

export interface BulkInventoryResponse {
  operation: BulkInventoryOperationResponse;
}

@Injectable({ providedIn: 'root' })
export class InventoryApiService {
  private readonly http = inject(HttpClient);

  register(payload: InventoryRequest): Observable<InventoryResponse> {
    return this.http.post<InventoryResponse>('/api/inventories', payload);
  }

  registerBulk(payload: BulkInventoryRequest): Observable<BulkInventoryResponse> {
    return this.http.post<BulkInventoryResponse>('/api/inventories/bulk', payload);
  }

  getById(id: string): Observable<InventoryOperationResponse> {
    return this.http.get<InventoryOperationResponse>(`/api/inventories/${encodeURIComponent(id)}`);
  }
}
