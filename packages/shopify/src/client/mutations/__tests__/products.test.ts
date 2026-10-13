import { describe, expect, it, vi } from 'vitest';
import type { RestoreOperation } from '@strlngco/fallback-core';
import { ShopifyUserError, type Requester } from '../../client';
import { restoreProduct } from '../products';

const PRODUCT_ID = 'gid://shopify/Product/1';

function flatProduct(): Record<string, unknown> {
  return {
    id: PRODUCT_ID, handle: 'tee', title: 'Old', descriptionHtml: '', productType: '',
    vendor: '', tags: [], status: 'ACTIVE', templateSuffix: null, options: [],
    seo: { title: null, description: null },
    createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z', publishedAt: null,
    variants: [],
  };
}

function fakeClient(responses: Record<string, unknown>): Requester {
  return {
    request: vi.fn(async (document: string) => {
      if (document.includes('productUpdate')) return responses['productUpdate'];
      if (document.includes('productVariantsBulkUpdate')) return responses['productVariantsBulkUpdate'];
      throw new Error('unexpected document');
    }),
  } as unknown as Requester;
}

describe('restoreProduct', () => {
  it('calls productUpdate with the built input and resolves on no userErrors', async () => {
    const client = fakeClient({ productUpdate: { productUpdate: { product: { id: PRODUCT_ID }, userErrors: [] } } });
    const op: RestoreOperation = {
      resource: 'products', id: PRODUCT_ID,
      changes: [{ path: 'title', before: 'Old', after: 'New' }],
      targetRecord: flatProduct(),
    };
    await expect(restoreProduct(client, op)).resolves.toBeUndefined();
    const call = (client.request as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call?.[1]).toEqual({ product: { id: PRODUCT_ID, title: 'Old' } });
  });

  it('throws ShopifyUserError when productUpdate returns userErrors', async () => {
    const client = fakeClient({
      productUpdate: { productUpdate: { product: null, userErrors: [{ field: ['title'], message: 'bad' }] } },
    });
    const op: RestoreOperation = {
      resource: 'products', id: PRODUCT_ID,
      changes: [{ path: 'title', before: 'Old', after: 'New' }],
      targetRecord: flatProduct(),
    };
    await expect(restoreProduct(client, op)).rejects.toBeInstanceOf(ShopifyUserError);
  });

  it('does not call productUpdate when only variant fields changed', async () => {
    const product = flatProduct();
    (product['variants'] as unknown[]).push({
      id: 'gid://shopify/ProductVariant/9', product: { id: PRODUCT_ID }, title: 'D', sku: 'S',
      barcode: null, price: { amount: '5.00', currencyCode: 'USD' }, compareAtPrice: null, position: 1,
      inventoryPolicy: 'DENY', inventoryQuantity: 0, taxable: true, taxCode: null, selectedOptions: [],
      inventoryItem: { id: 'gid://shopify/InventoryItem/9', tracked: true, requiresShipping: true, measurement: { weight: null } },
      createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z',
    });
    const client = fakeClient({
      productVariantsBulkUpdate: { productVariantsBulkUpdate: { productVariants: [{ id: 'x' }], userErrors: [] } },
    });
    const op: RestoreOperation = {
      resource: 'products', id: PRODUCT_ID,
      changes: [{ path: 'variants[gid://shopify/ProductVariant/9].price.amount', before: '5.00', after: '6.00' }],
      targetRecord: product,
    };
    await restoreProduct(client, op);
    const docs = (client.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(docs.some((d) => d.includes('productVariantsBulkUpdate'))).toBe(true);
    expect(docs.some((d) => d.includes('productUpdate('))).toBe(false);
  });
});
