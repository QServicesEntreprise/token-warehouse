import type { InventoryCommand } from '../domain/inventory-command';
import type { InventoryCommandDto } from './dto/inventory-command.dto';

export const mapInventoryCommand = (command: InventoryCommand): InventoryCommandDto => ({
  ean13: command.ean13,
  countedQuantity: command.countedQuantity,
});
