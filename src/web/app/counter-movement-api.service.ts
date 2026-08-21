import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export type CounterMovementSourceType = 'SUPPLY' | 'INVENTORY' | 'SALE';
export type CounterMovementAvailability = 'AVAILABLE' | 'OUT_OF_STOCK' | 'NOT_SELLABLE';
export type CounterMovementReason = 'ARCHIVED' | 'DLC_EXPIRED' | 'UNSELLABLE_PACKAGING';

export interface CounterMovementSourceLine {
  lineNumber: number;
  ean13: string;
  stockEffect: number;
}

export interface CounterMovementSource {
  id: string;
  type: CounterMovementSourceType;
  timestampUtc: string;
  ean13: string;
  lines: CounterMovementSourceLine[];
}

export interface CounterMovementPayload {
  sourceOperationId: string;
  justification: string;
}

export interface CounterMovementLineResponse {
  lineNumber: number;
  ean13: string;
  sourceEffect: number;
  inverseEffect: number;
}

export interface CounterMovementPositionResponse {
  ean13: string;
  physicalStock: number;
  sellableStock: number;
  availability: CounterMovementAvailability;
  reason: CounterMovementReason | null;
}

export interface CounterMovementResponse {
  counterMovement: {
    id: string;
    type: 'COUNTER_MOVEMENT';
    timestampUtc: string;
    sourceOperationId: string;
    sourceOperationType: CounterMovementSourceType;
    justification: string;
    lines: CounterMovementLineResponse[];
  };
  source: CounterMovementSource;
  positions: CounterMovementPositionResponse[];
}

@Injectable({ providedIn: 'root' })
export class CounterMovementApiService {
  private readonly http = inject(HttpClient);

  listSources(): Observable<CounterMovementSource[]> {
    return this.http.get<CounterMovementSource[]>('/api/stock/counter-movements/sources');
  }

  correct(payload: CounterMovementPayload): Observable<CounterMovementResponse> {
    return this.http.post<CounterMovementResponse>('/api/stock/counter-movements', payload);
  }
}
