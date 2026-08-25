import type { ConsumptionMode } from '../../../../shared-kernel/consumption-mode';
import type { Packaging } from '../../domain/packaging';

export interface ArticleAttributesUpdatePayloadDto {
  name?: string;
  dlc?: string;
  consumptionModes?: ConsumptionMode[];
  packaging?: Packaging;
}
