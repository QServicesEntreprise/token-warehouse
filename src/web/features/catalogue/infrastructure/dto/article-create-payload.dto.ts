import { ConsumptionMode } from '../../../../shared-kernel/consumption-mode';
import { ArticleType } from '../../domain/article-type';
import { Packaging } from '../../domain/packaging';

export interface ArticleCreatePayloadDto {
  ean13: string;
  type: ArticleType;
  name: string;
  priceHtCents: number;
  dlc?: string;
  consumptionModes?: ConsumptionMode[];
  packaging?: Packaging;
}
