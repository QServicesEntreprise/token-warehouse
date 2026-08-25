import type { ConsumptionMode } from '../../../../shared-kernel/consumption-mode';
import type { ArticleType } from '../../domain/article-type';
import type { Packaging } from '../../domain/packaging';

export interface ArticleCreatePayloadDto {
  ean13: string;
  type: ArticleType;
  name: string;
  priceHtCents: number;
  dlc?: string;
  consumptionModes?: ConsumptionMode[];
  packaging?: Packaging;
}
