import { describe, expect, it } from 'vitest';
import { mapInventoryCommand } from './map-inventory-command';

describe('mapInventoryCommand', () => {
  it('maps the Inventory command to the HTTP vocabulary', () => {
    expect(mapInventoryCommand({ ean13: '0123456789012', countedQuantity: 11 })).toEqual({
      ean13: '0123456789012',
      countedQuantity: 11,
    });
  });
});
