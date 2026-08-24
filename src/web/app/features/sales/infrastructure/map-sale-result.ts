import { SaleResult } from '../domain/sale-result';
import { SaleResultDto } from './sale-result.dto';

export const mapSaleResult = (dto: SaleResultDto): SaleResult => ({
  operation: dto.operation,
  financial: dto.financial,
  position: dto.position,
});
