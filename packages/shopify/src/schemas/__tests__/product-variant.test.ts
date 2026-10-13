import { describe, expect, it } from 'vitest';
import { ProductVariantSchema } from '../product-variant';

describe('ProductVariantSchema', () => {
  const fixture = {
    id: 'gid://shopify/ProductVariant/100',
    product: { id: 'gid://shopify/Product/1' },
    title: 'S',
    sku: 'TEE-S',
    barcode: '0001',
    price: { amount: '19.99', currencyCode: 'USD' },
    compareAtPrice: { amount: '24.99', currencyCode: 'USD' },
    position: 1,
    inventoryPolicy: 'DENY',
    inventoryQuantity: 12,
    taxable: true,
    taxCode: null,
    selectedOptions: [{ name: 'Size', value: 'S' }],
    inventoryItem: {
      id: 'gid://shopify/InventoryItem/1000',
      tracked: true,
      requiresShipping: true,
      measurement: {
        weight: { value: 200, unit: 'GRAMS' },
      },
    },
    createdAt: '2026-05-01T12:00:00Z',
    updatedAt: '2026-05-02T12:00:00Z',
  };

  it('parses a representative variant', () => {
    expect(() => ProductVariantSchema.parse(fixture)).not.toThrow();
  });

  it('accepts a variant with no SKU, no compare-at price, and no weight', () => {
    const minimal = {
      ...fixture,
      sku: null,
      barcode: null,
      compareAtPrice: null,
      inventoryItem: { ...fixture.inventoryItem, measurement: { weight: null } },
    };
    expect(() => ProductVariantSchema.parse(minimal)).not.toThrow();
  });

  it.each(['CAD', 'GBP', 'EUR', 'JPY'])(
    'accepts %s pricing on a non-USD variant',
    (currencyCode) => {
      const localized = {
        ...fixture,
        price: { amount: '24.99', currencyCode },
        compareAtPrice: { amount: '29.99', currencyCode },
      };
      expect(() => ProductVariantSchema.parse(localized)).not.toThrow();
    },
  );

  it('rejects a price amount that is not a decimal string', () => {
    const bad = {
      ...fixture,
      price: { amount: '$19.99', currencyCode: 'USD' },
    };
    expect(() => ProductVariantSchema.parse(bad)).toThrow();
  });

  it('rejects a lowercase currency code', () => {
    const bad = {
      ...fixture,
      price: { amount: '19.99', currencyCode: 'usd' },
    };
    expect(() => ProductVariantSchema.parse(bad)).toThrow();
  });

  it('rejects a currency code that is not three letters', () => {
    const bad = {
      ...fixture,
      price: { amount: '19.99', currencyCode: 'US' },
    };
    expect(() => ProductVariantSchema.parse(bad)).toThrow();
  });

  it('rejects an unknown inventory policy', () => {
    const bad = { ...fixture, inventoryPolicy: 'IGNORE' };
    expect(() => ProductVariantSchema.parse(bad)).toThrow();
  });
});
