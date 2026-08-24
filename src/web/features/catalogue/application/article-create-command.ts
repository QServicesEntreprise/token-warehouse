import { ConsumptionMode } from '../../../shared-kernel/consumption-mode';
import { Packaging } from '../domain/packaging';

interface ArticleCreateCommandBase {
  ean13: string;
  name: string;
  priceHtCents: number;
}

export type ArticleCreateCommand = ArticleCreateCommandBase & (
  | { type: 'food'; dlc: string; consumptionModes: ConsumptionMode[]; packaging?: never }
  | { type: 'nonFood'; packaging: Packaging; dlc?: never; consumptionModes?: never }
);
