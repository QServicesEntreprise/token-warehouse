import { SaleCommand } from '../domain/sale-command';
import { SaleCommandDto } from './sale-command.dto';

export const mapSaleCommand = (command: SaleCommand): SaleCommandDto => ({ ...command });
