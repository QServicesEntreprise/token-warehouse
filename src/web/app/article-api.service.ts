import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export type ArticleType = 'food' | 'nonFood';
export type ConsumptionMode = 'takeaway' | 'onsite';
export type Packaging = 'new' | 'refurbished' | 'unsellable';

export interface ArticleCreatePayload {
  ean13: string;
  type: ArticleType;
  name: string;
  priceHtCents: number;
  dlc?: string;
  consumptionModes?: ConsumptionMode[];
  packaging?: Packaging;
}

export interface ArticleResponse extends ArticleCreatePayload {
  isActive: boolean;
}

export interface ProblemDetails {
  code?: string;
  errors?: Record<string, string[]>;
  title?: string;
}

@Injectable({ providedIn: 'root' })
export class ArticleApiService {
  private readonly http = inject(HttpClient);

  create(payload: ArticleCreatePayload): Observable<ArticleResponse> {
    return this.http.post<ArticleResponse>('/api/articles', payload);
  }

  getByEan13(ean13: string): Observable<ArticleResponse> {
    return this.http.get<ArticleResponse>(`/api/articles/${encodeURIComponent(ean13)}`);
  }
}
