import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class CatalogueInvalidation {
  private readonly changedArticles = new Subject<string>();
  readonly articleChanges = this.changedArticles.asObservable();

  notifyArticleChanged(ean13: string): void {
    this.changedArticles.next(ean13);
  }
}
