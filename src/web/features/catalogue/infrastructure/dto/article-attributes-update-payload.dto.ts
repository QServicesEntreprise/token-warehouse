import { ConsumptionMode } from '../../../../shared-kernel/consumption-mode';
import { Packaging } from '../../domain/packaging';

export interface ArticleAttributesUpdatePayloadDto {
  name?: string;
  dlc?: string;
  consumptionModes?: ConsumptionMode[];
  packaging?: Packaging;
}
