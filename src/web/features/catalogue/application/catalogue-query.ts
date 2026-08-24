import { ConsumptionMode } from '../../../shared-kernel/consumption-mode';
import { ArticleType } from '../domain/article-type';
import { CatalogueStatus } from '../domain/catalogue-status';
import { Packaging } from '../domain/packaging';

export interface CatalogueQuery {
  status: CatalogueStatus;
  search?: string;
  type?: ArticleType;
  mode?: ConsumptionMode;
  packaging?: Packaging;
}
