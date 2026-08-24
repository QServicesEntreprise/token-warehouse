import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, throwError } from 'rxjs';
import { ArticleAttributesUpdateCommand } from '../application/article-attributes-update-command';
import { ArticleCreateCommand } from '../application/article-create-command';
import { CatalogueGateway } from '../application/catalogue-gateway';
import { CatalogueQuery } from '../application/catalogue-query';
import { Article } from '../domain/article';
import { ArticleSummary } from '../domain/article-summary';
import { ArticleAttributesUpdatePayloadDto } from './dto/article-attributes-update-payload.dto';
import { ArticleCreatePayloadDto } from './dto/article-create-payload.dto';
import { ArticleDto } from './dto/article.dto';
import { ArticlePriceUpdatePayloadDto } from './dto/article-price-update-payload.dto';
import { mapArticleDto } from './map-article-dto';
import { mapArticleSummaryDto } from './map-article-summary-dto';
import { mapProblemDetails } from './map-problem-details';

@Injectable()
export class HttpCatalogueGateway implements CatalogueGateway {
  private readonly http = inject(HttpClient);

  search(query: CatalogueQuery): Observable<readonly ArticleSummary[]> {
    let params = new HttpParams().set('status', query.status);
    const search = query.search?.trim();
    if (search) params = params.set('search', search);
    if (query.type) params = params.set('type', query.type);
    if (query.mode) params = params.set('mode', query.mode);
    if (query.packaging) params = params.set('packaging', query.packaging);
    return this.http.get<ArticleDto[]>('/api/articles', { params }).pipe(
      map((articles) => articles.map(mapArticleSummaryDto)),
      catchError((error: unknown) => throwError(() => mapProblemDetails(error, 'Le Catalogue ne peut pas être chargé. Réessayez.'))),
    );
  }

  get(ean13: string): Observable<Article> {
    return this.http.get<ArticleDto>(`/api/articles/${encodeURIComponent(ean13)}`).pipe(
      map(mapArticleDto),
      catchError((error: unknown) => throwError(() => mapProblemDetails(error, 'Article introuvable.'))),
    );
  }

  create(command: ArticleCreateCommand): Observable<Article> {
    const payload: ArticleCreatePayloadDto = { ...command };
    return this.http.post<ArticleDto>('/api/articles', payload).pipe(
      map(mapArticleDto),
      catchError((error: unknown) => throwError(() => mapProblemDetails(error, 'La création a échoué.'))),
    );
  }

  updateAttributes(ean13: string, command: ArticleAttributesUpdateCommand): Observable<Article> {
    const payload: ArticleAttributesUpdatePayloadDto = { ...command };
    return this.http.patch<ArticleDto>(`/api/articles/${encodeURIComponent(ean13)}`, payload).pipe(
      map(mapArticleDto),
      catchError((error: unknown) => throwError(() => mapProblemDetails(error, 'La modification des attributs a échoué.'))),
    );
  }

  updatePrice(ean13: string, priceHtCents: number): Observable<Article> {
    const payload: ArticlePriceUpdatePayloadDto = { priceHtCents };
    return this.http.patch<ArticleDto>(`/api/articles/${encodeURIComponent(ean13)}`, payload).pipe(
      map(mapArticleDto),
      catchError((error: unknown) => throwError(() => mapProblemDetails(error, 'La mise à jour a échoué.'))),
    );
  }

  archive(ean13: string): Observable<Article> {
    return this.http.post<ArticleDto>(`/api/articles/${encodeURIComponent(ean13)}/archive`, null).pipe(
      map(mapArticleDto),
      catchError((error: unknown) => throwError(() => mapProblemDetails(error, 'La transition du cycle de vie a échoué.'))),
    );
  }

  reactivate(ean13: string): Observable<Article> {
    return this.http.post<ArticleDto>(`/api/articles/${encodeURIComponent(ean13)}/reactivate`, null).pipe(
      map(mapArticleDto),
      catchError((error: unknown) => throwError(() => mapProblemDetails(error, 'La transition du cycle de vie a échoué.'))),
    );
  }
}
