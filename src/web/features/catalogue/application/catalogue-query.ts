import { ConsumptionMode } from '../../../shared-kernel/consumption-mode';
import { ArticleType } from '../domain/article-type';
import { ArticleStatusFilter } from '../domain/article-status-filter';
import { Packaging } from '../domain/packaging';

export interface CatalogueQuery {
  status: ArticleStatusFilter;
  search?: string;
  type?: ArticleType;
  mode?: ConsumptionMode;
  packaging?: Packaging;
}
