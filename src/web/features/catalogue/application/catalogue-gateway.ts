import { Observable } from 'rxjs';
import { Article } from '../domain/article';
import { ArticleSummary } from '../domain/article-summary';
import { ArticleAttributesUpdateCommand } from './article-attributes-update-command';
import { ArticleCreateCommand } from './article-create-command';
import { CatalogueQuery } from './catalogue-query';

export interface CatalogueGateway {
  search(query: CatalogueQuery): Observable<readonly ArticleSummary[]>;
  get(ean13: string): Observable<Article>;
  create(command: ArticleCreateCommand): Observable<Article>;
  updateAttributes(ean13: string, command: ArticleAttributesUpdateCommand): Observable<Article>;
  updatePrice(ean13: string, priceHtCents: number): Observable<Article>;
  archive(ean13: string): Observable<Article>;
  reactivate(ean13: string): Observable<Article>;
}
