import { Observable, of } from 'rxjs';
import type { Article } from '../../domain/article';
import type { ArticleSummary } from '../../domain/article-summary';
import type { ArticleAttributesUpdateCommand } from '../article-attributes-update-command';
import type { ArticleCreateCommand } from '../article-create-command';
import type { CatalogueGateway } from '../catalogue-gateway';
import type { CatalogueQuery } from '../catalogue-query';

export class FakeCatalogueGateway implements CatalogueGateway {
  searchHandler: (query: CatalogueQuery) => Observable<readonly ArticleSummary[]> = () => of([]);
  getHandler: (ean13: string) => Observable<Article> = () => of({} as Article);
  createHandler: (command: ArticleCreateCommand) => Observable<Article> = () => of({} as Article);
  updateAttributesHandler: (ean13: string, command: ArticleAttributesUpdateCommand) => Observable<Article> = () => of({} as Article);
  updatePriceHandler: (ean13: string, priceHtCents: number) => Observable<Article> = () => of({} as Article);
  archiveHandler: (ean13: string) => Observable<Article> = () => of({} as Article);
  reactivateHandler: (ean13: string) => Observable<Article> = () => of({} as Article);

  search(query: CatalogueQuery): Observable<readonly ArticleSummary[]> {
    return this.searchHandler(query);
  }

  get(ean13: string): Observable<Article> {
    return this.getHandler(ean13);
  }

  create(command: ArticleCreateCommand): Observable<Article> {
    return this.createHandler(command);
  }

  updateAttributes(ean13: string, command: ArticleAttributesUpdateCommand): Observable<Article> {
    return this.updateAttributesHandler(ean13, command);
  }

  updatePrice(ean13: string, priceHtCents: number): Observable<Article> {
    return this.updatePriceHandler(ean13, priceHtCents);
  }

  archive(ean13: string): Observable<Article> {
    return this.archiveHandler(ean13);
  }

  reactivate(ean13: string): Observable<Article> {
    return this.reactivateHandler(ean13);
  }
}
