import type { SaleCommand } from '../domain/sale-command';
import type { SaleCommandDto } from './sale-command.dto';

export const mapSaleCommand = (command: SaleCommand): SaleCommandDto => ({ ...command });
