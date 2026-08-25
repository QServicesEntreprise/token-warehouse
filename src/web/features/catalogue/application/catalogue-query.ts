import type { ConsumptionMode } from '../../../shared-kernel/consumption-mode';
import type { ArticleType } from '../domain/article-type';
import type { ArticleStatusFilter } from '../domain/article-status-filter';
import type { Packaging } from '../domain/packaging';

export interface CatalogueQuery {
  status: ArticleStatusFilter;
  search?: string;
  type?: ArticleType;
  mode?: ConsumptionMode;
  packaging?: Packaging;
}
