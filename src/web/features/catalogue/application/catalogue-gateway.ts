import type { Observable } from 'rxjs';
import type { Article } from '../domain/article';
import type { ArticleSummary } from '../domain/article-summary';
import type { ArticleAttributesUpdateCommand } from './article-attributes-update-command';
import type { ArticleCreateCommand } from './article-create-command';
import type { CatalogueQuery } from './catalogue-query';

export interface CatalogueGateway {
  search(query: CatalogueQuery): Observable<readonly ArticleSummary[]>;
  get(ean13: string): Observable<Article>;
  create(command: ArticleCreateCommand): Observable<Article>;
  updateAttributes(ean13: string, command: ArticleAttributesUpdateCommand): Observable<Article>;
  updatePrice(ean13: string, priceHtCents: number): Observable<Article>;
  archive(ean13: string): Observable<Article>;
  reactivate(ean13: string): Observable<Article>;
}
