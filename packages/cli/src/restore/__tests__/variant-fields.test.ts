import { describe, expect, it } from 'vitest';
import { buildRestorePlan, diffResources, type SnapshotDiff } from '@strlngco/fallback-core';
import { buildProductMutationInputs } from '@strlngco/fallback-shopify';
import { PRODUCT_FIELD_CHANGES_CONFIG } from '../../diff/compute';
import { RESTORE_PLAN_CONFIG } from '../config';

// Drives real diff paths through the plan builder and input mapping. Tests that
// hand-write change paths can agree with the mapping while the differ emits
// something else, which is how SKU restore silently did nothing.

const PRODUCT_ID = 'gid://shopify/Product/1';
const VARIANT_ID = 'gid://shopify/ProductVariant/100';

function snapshotProduct(): Record<string, unknown> {
  return {
    id: PRODUCT_ID,
    handle: 'tee',
    title: 'Tee',
    descriptionHtml: '<p>tee</p>',
    productType: 'Shirts',
    vendor: 'Example',
    tags: ['a'],
    status: 'ACTIVE',
    templateSuffix: null,
    options: [],
    seo: { title: null, description: null },
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    publishedAt: '2026-05-01T00:00:00Z',
    variants: [
      {
        id: VARIANT_ID,
        product: { id: PRODUCT_ID },
        title: 'Default',
        sku: 'TEE-OLD',
        barcode: '111',
        price: { amount: '19.99', currencyCode: 'USD' },
        compareAtPrice: { amount: '29.99', currencyCode: 'USD' },
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

async function restoreInputsFor(drift: (variant: Record<string, any>) => void) {
  const snapshot = snapshotProduct();
  const current = structuredClone(snapshot);
  drift((current.variants as Record<string, any>[])[0]!);

  const products = await diffResources({
    snapshot: [snapshot],
    current: [current],
    getId: (record) => String(record.id),
    fieldChangesConfig: PRODUCT_FIELD_CHANGES_CONFIG,
  });
  const diff = {
    snapshotId: 's',
    shop: 'example-store.myshopify.com',
    computedAt: '2026-10-12T00:00:00.000Z',
    resources: { products },
  } as SnapshotDiff;
  const plan = buildRestorePlan({
    snapshotId: 's',
    shop: 'example-store.myshopify.com',
    builtAt: '2026-10-12T00:00:00.000Z',
    diff,
    config: RESTORE_PLAN_CONFIG,
  });

  expect(plan.skipped.unsupported).toEqual([]);
  expect(plan.operations).toHaveLength(1);
  return buildProductMutationInputs(plan.operations[0]!);
}

describe('variant field restore, from a real diff', () => {
  it('restores SKU through the inventoryItem input', async () => {
    const inputs = await restoreInputsFor((v) => { v.sku = 'TEE-NEW'; });
    expect(inputs.variants).toEqual([{ id: VARIANT_ID, inventoryItem: { sku: 'TEE-OLD' } }]);
  });

  it('restores price', async () => {
    const inputs = await restoreInputsFor((v) => { v.price.amount = '24.99'; });
    expect(inputs.variants).toEqual([{ id: VARIANT_ID, price: '19.99' }]);
  });

  it('restores compare-at price', async () => {
    const inputs = await restoreInputsFor((v) => { v.compareAtPrice = null; });
    expect(inputs.variants).toEqual([{ id: VARIANT_ID, compareAtPrice: '29.99' }]);
  });

  it('restores barcode', async () => {
    const inputs = await restoreInputsFor((v) => { v.barcode = '222'; });
    expect(inputs.variants).toEqual([{ id: VARIANT_ID, barcode: '111' }]);
  });

  it('restores taxable', async () => {
    const inputs = await restoreInputsFor((v) => { v.taxable = false; });
    expect(inputs.variants).toEqual([{ id: VARIANT_ID, taxable: true }]);
  });

  it('restores tax code', async () => {
    const inputs = await restoreInputsFor((v) => { v.taxCode = 'C100'; });
    expect(inputs.variants).toEqual([{ id: VARIANT_ID, taxCode: null }]);
  });

  it('restores inventory policy', async () => {
    const inputs = await restoreInputsFor((v) => { v.inventoryPolicy = 'CONTINUE'; });
    expect(inputs.variants).toEqual([{ id: VARIANT_ID, inventoryPolicy: 'DENY' }]);
  });

  it('restores weight', async () => {
    const inputs = await restoreInputsFor((v) => { v.inventoryItem.measurement.weight.value = 250; });
    expect(inputs.variants).toEqual([
      { id: VARIANT_ID, inventoryItem: { measurement: { weight: { value: 200, unit: 'GRAMS' } } } },
    ]);
  });
});
