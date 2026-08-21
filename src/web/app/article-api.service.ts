import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export type ArticleType = 'food' | 'nonFood';
export type ConsumptionMode = 'takeaway' | 'onsite';
export type Packaging = 'new' | 'refurbished' | 'unsellable';
export type ArticleListStatus = 'active' | 'archived' | 'all';
export type ArticleStatus = 'active' | 'archived';

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
  status: ArticleStatus;
  priceQuotes: PriceQuote[];
}

export type ArticleListResponse = Omit<ArticleResponse, 'priceQuotes'>;

export interface PriceQuote {
  saleContext?: ConsumptionMode;
  taxRate: {
    code: string;
    ratio: string;
    numerator: number;
    denominator: number;
  };
  vatCents: number;
  priceTtcCents: number;
}

export interface ArticlePriceUpdatePayload {
  priceHtCents: number;
}

export interface ArticleAttributesUpdatePayload {
  name?: string;
  dlc?: string;
  consumptionModes?: ConsumptionMode[];
  packaging?: Packaging;
}

export interface ArticleListQuery {
  status: ArticleListStatus;
  search?: string;
  type?: ArticleType;
  mode?: ConsumptionMode;
  packaging?: Packaging;
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

  list(query: ArticleListQuery): Observable<ArticleListResponse[]> {
    let params = new HttpParams().set('status', query.status);
    const search = query.search?.trim();
    if (search) {
      params = params.set('search', search);
    }
    if (query.type) {
      params = params.set('type', query.type);
    }
    if (query.mode) {
      params = params.set('mode', query.mode);
    }
    if (query.packaging) {
      params = params.set('packaging', query.packaging);
    }
    return this.http.get<ArticleResponse[]>('/api/articles', { params });
  }

  updatePriceHt(ean13: string, payload: ArticlePriceUpdatePayload): Observable<ArticleResponse> {
    return this.http.patch<ArticleResponse>(`/api/articles/${encodeURIComponent(ean13)}`, payload);
  }

  updateAttributes(ean13: string, payload: ArticleAttributesUpdatePayload): Observable<ArticleResponse> {
    return this.http.patch<ArticleResponse>(`/api/articles/${encodeURIComponent(ean13)}`, payload);
  }

  archive(ean13: string): Observable<ArticleResponse> {
    return this.http.post<ArticleResponse>(`/api/articles/${encodeURIComponent(ean13)}/archive`, null);
  }

  reactivate(ean13: string): Observable<ArticleResponse> {
    return this.http.post<ArticleResponse>(`/api/articles/${encodeURIComponent(ean13)}/reactivate`, null);
  }
}
