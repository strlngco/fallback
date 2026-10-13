import { describe, expect, it, vi } from 'vitest';
import { ShopifyAuthError, type Requester } from '../../client';
import { fetchProducts } from '../products';

function makeVariantNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gid://shopify/ProductVariant/100',
    title: 'S',
    sku: 'TEE-S',
    barcode: null,
    price: '19.99',
    compareAtPrice: null,
    position: 1,
    inventoryPolicy: 'DENY',
    inventoryQuantity: 5,
    taxable: true,
    taxCode: null,
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    product: { id: 'gid://shopify/Product/1' },
    selectedOptions: [{ name: 'Size', value: 'S' }],
    inventoryItem: {
      id: 'gid://shopify/InventoryItem/1000',
      tracked: true,
      requiresShipping: true,
      measurement: { weight: { value: 200, unit: 'GRAMS' } },
    },
    ...overrides,
  };
}

function makeProductNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gid://shopify/Product/1',
    handle: 'tee',
    title: 'Tee',
    descriptionHtml: '<p>tee</p>',
    productType: 'Shirts',
    vendor: 'Strlng',
    tags: [],
    status: 'ACTIVE',
    templateSuffix: null,
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    publishedAt: '2026-05-01T00:00:00Z',
    seo: { title: null, description: null },
    options: [
      { id: 'gid://shopify/ProductOption/10', name: 'Size', position: 1, values: ['S'] },
    ],
    variants: {
      edges: [{ node: makeVariantNode() }],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    ...overrides,
  };
}

function makePage(
  nodes: Array<ReturnType<typeof makeProductNode>>,
  pageInfo: { hasNextPage: boolean; endCursor: string | null },
  currencyCode = 'USD',
) {
  return {
    shop: { currencyCode },
    products: {
      edges: nodes.map((node) => ({ node })),
      pageInfo,
    },
  };
}

function fakeClient() {
  const request = vi.fn();
  return { request, client: { request } as unknown as Requester };
}

describe('fetchProducts', () => {
  it('paginates across pages and composes MoneyV2 from shop.currencyCode + variant.price', async () => {
    const { request, client } = fakeClient();
    request
      .mockResolvedValueOnce(
        makePage([makeProductNode()], { hasNextPage: true, endCursor: 'c1' }),
      )
      .mockResolvedValueOnce(
        makePage(
          [makeProductNode({ id: 'gid://shopify/Product/2', handle: 'mug' })],
          { hasNextPage: false, endCursor: null },
        ),
      );

    const collected: Array<{ id: string; price: { amount: string; currencyCode: string } }> = [];
    for await (const item of fetchProducts(client)) {
      collected.push({ id: item.product.id, price: item.variants[0]!.price });
    }

    expect(collected).toHaveLength(2);
    expect(collected[0]?.id).toBe('gid://shopify/Product/1');
    expect(collected[0]?.price).toEqual({ amount: '19.99', currencyCode: 'USD' });
    expect(collected[1]?.id).toBe('gid://shopify/Product/2');
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(1, expect.any(String), { cursor: null });
    expect(request).toHaveBeenNthCalledWith(2, expect.any(String), { cursor: 'c1' });
  });

  it('honors the shop currency for non-USD storefronts (CAD)', async () => {
    const { request, client } = fakeClient();
    request.mockResolvedValueOnce(
      makePage([makeProductNode()], { hasNextPage: false, endCursor: null }, 'CAD'),
    );

    const products = [];
    for await (const item of fetchProducts(client)) products.push(item);
    expect(products[0]?.variants[0]?.price).toEqual({
      amount: '19.99',
      currencyCode: 'CAD',
    });
  });

  it('paginates nested variants via the continuation query when a product exceeds the variant page size', async () => {
    const { request, client } = fakeClient();
    const overflowing = makeProductNode({
      variants: {
        edges: [{ node: makeVariantNode({ id: 'gid://shopify/ProductVariant/1' }) }],
        pageInfo: { hasNextPage: true, endCursor: 'v1' },
      },
    });
    request
      .mockResolvedValueOnce(
        makePage([overflowing], { hasNextPage: false, endCursor: null }),
      )
      .mockResolvedValueOnce({
        product: {
          variants: {
            edges: [
              { node: makeVariantNode({ id: 'gid://shopify/ProductVariant/2' }) },
              { node: makeVariantNode({ id: 'gid://shopify/ProductVariant/3' }) },
            ],
            pageInfo: { hasNextPage: true, endCursor: 'v2' },
          },
        },
      })
      .mockResolvedValueOnce({
        product: {
          variants: {
            edges: [{ node: makeVariantNode({ id: 'gid://shopify/ProductVariant/4' }) }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });

    const products = [];
    for await (const item of fetchProducts(client)) products.push(item);

    expect(products).toHaveLength(1);
    expect(products[0]?.variants.map((v) => v.id)).toEqual([
      'gid://shopify/ProductVariant/1',
      'gid://shopify/ProductVariant/2',
      'gid://shopify/ProductVariant/3',
      'gid://shopify/ProductVariant/4',
    ]);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenNthCalledWith(2, expect.any(String), {
      productId: 'gid://shopify/Product/1',
      cursor: 'v1',
    });
    expect(request).toHaveBeenNthCalledWith(3, expect.any(String), {
      productId: 'gid://shopify/Product/1',
      cursor: 'v2',
    });
  });

  it('accepts products with extended product status values for forward compatibility', async () => {
    const { request, client } = fakeClient();
    const extended = makeProductNode({ status: 'UNLISTED' });
    request.mockResolvedValueOnce(
      makePage([extended], { hasNextPage: false, endCursor: null }),
    );

    const collected: unknown[] = [];
    for await (const item of fetchProducts(client)) {
      collected.push(item);
    }
    expect(collected).toHaveLength(1);
    expect((collected[0] as any).product.status).toBe('UNLISTED');
  });

  it('propagates auth errors from the underlying client', async () => {
    const { request, client } = fakeClient();
    request.mockRejectedValueOnce(new ShopifyAuthError('bad token'));

    await expect(async () => {
      for await (const _ of fetchProducts(client)) {
        void _;
      }
    }).rejects.toBeInstanceOf(ShopifyAuthError);
  });
});
