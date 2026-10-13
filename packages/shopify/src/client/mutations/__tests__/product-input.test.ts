import { describe, expect, it } from 'vitest';
import type { RestoreOperation } from '@strlngco/fallback-core';
import { buildProductMutationInputs } from '../product-input';

const PRODUCT_ID = 'gid://shopify/Product/1';
const VARIANT_ID = 'gid://shopify/ProductVariant/100';

function flatProduct(): Record<string, unknown> {
  return {
    id: PRODUCT_ID,
    handle: 'tee',
    title: 'Old Title',
    descriptionHtml: '<p>old</p>',
    productType: 'Shirts',
    vendor: 'Strlng',
    tags: ['a', 'b'],
    status: 'ACTIVE',
    templateSuffix: null,
    options: [],
    seo: { title: 'Old SEO', description: null },
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    publishedAt: '2026-05-01T00:00:00Z',
    variants: [
      {
        id: VARIANT_ID,
        product: { id: PRODUCT_ID },
        title: 'Default',
        sku: 'TEE-OLD',
        barcode: null,
        price: { amount: '19.99', currencyCode: 'USD' },
        compareAtPrice: null,
        position: 1,
        inventoryPolicy: 'DENY',
        inventoryQuantity: 5,
        taxable: true,
        taxCode: null,
        selectedOptions: [],
        inventoryItem: {
          id: 'gid://shopify/InventoryItem/1000',
          tracked: true,
          requiresShipping: true,
          measurement: { weight: { value: 200, unit: 'GRAMS' } },
        },
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: '2026-05-01T00:00:00Z',
      },
    ],
  };
}

function op(changes: RestoreOperation['changes']): RestoreOperation {
  return { resource: 'products', id: PRODUCT_ID, changes, targetRecord: flatProduct() };
}

describe('buildProductMutationInputs', () => {
  it('builds a product input with only the changed scalar fields, set to snapshot values', () => {
    const inputs = buildProductMutationInputs(
      op([
        { path: 'title', before: 'Old Title', after: 'New Title' },
        { path: 'tags', before: ['a', 'b'], after: ['c'] },
      ]),
    );
    expect(inputs.product).toEqual({ id: PRODUCT_ID, title: 'Old Title', tags: ['a', 'b'] });
    expect(inputs.variants).toEqual([]);
  });

  it('sets the full seo pair when any seo field drifts', () => {
    const inputs = buildProductMutationInputs(op([{ path: 'seo.title', before: 'Old SEO', after: 'New SEO' }]));
    expect(inputs.product).toEqual({ id: PRODUCT_ID, seo: { title: 'Old SEO', description: null } });
  });

  it('builds a variant input mapping MoneyV2 to the Money scalar and only changed fields', () => {
    const inputs = buildProductMutationInputs(
      op([{ path: `variants[${VARIANT_ID}].price.amount`, before: '19.99', after: '24.99' }]),
    );
    expect(inputs.product).toBeNull();
    expect(inputs.variants).toEqual([{ id: VARIANT_ID, price: '19.99' }]);
  });

  it('maps variant sku and weight into the inventoryItem input', () => {
    const inputs = buildProductMutationInputs(
      op([
        { path: `variants[${VARIANT_ID}].sku`, before: 'TEE-OLD', after: 'TEE-NEW' },
        { path: `variants[${VARIANT_ID}].inventoryItem.measurement.weight.value`, before: 200, after: 250 },
      ]),
    );
    expect(inputs.variants).toEqual([
      {
        id: VARIANT_ID,
        inventoryItem: { sku: 'TEE-OLD', measurement: { weight: { value: 200, unit: 'GRAMS' } } },
      },
    ]);
  });
});
