import { describe, expect, it } from 'vitest';
import { InventoryLevelSchema } from '../inventory-level';

describe('InventoryLevelSchema', () => {
  const fixture = {
    id: 'gid://shopify/InventoryLevel/500',
    item: { id: 'gid://shopify/InventoryItem/1000' },
    location: { id: 'gid://shopify/Location/1', name: 'Main Warehouse' },
    quantities: [
      { name: 'available', quantity: 12 },
      { name: 'on_hand', quantity: 12 },
      { name: 'committed', quantity: 0 },
    ],
    updatedAt: '2026-05-02T12:00:00Z',
  };

  it('parses a representative inventory level', () => {
    expect(() => InventoryLevelSchema.parse(fixture)).not.toThrow();
  });

  it('allows negative quantities (committed/reserved can exceed available)', () => {
    const negative = {
      ...fixture,
      quantities: [{ name: 'available', quantity: -3 }],
    };
    expect(() => InventoryLevelSchema.parse(negative)).not.toThrow();
  });

  it('rejects a non-integer quantity', () => {
    const bad = {
      ...fixture,
      quantities: [{ name: 'available', quantity: 1.5 }],
    };
    expect(() => InventoryLevelSchema.parse(bad)).toThrow();
  });

  it('accepts an InventoryLevel id with an inventory_item_id query-string suffix', () => {
    const withSuffix = {
      ...fixture,
      id: 'gid://shopify/InventoryLevel/500?inventory_item_id=1000',
    };
    expect(() => InventoryLevelSchema.parse(withSuffix)).not.toThrow();
  });

  it('still rejects a level id pointing at a non-InventoryLevel resource type', () => {
    const wrongType = {
      ...fixture,
      id: 'gid://shopify/Product/500?inventory_item_id=1000',
    };
    expect(() => InventoryLevelSchema.parse(wrongType)).toThrow();
  });
});
