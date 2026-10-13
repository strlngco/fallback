import { describe, expect, it, vi } from 'vitest';
import { type Requester } from '../../client';
import { fetchCollections } from '../collections';

function makeCustomCollectionNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gid://shopify/Collection/200',
    handle: 'summer-sale',
    title: 'Summer Sale',
    descriptionHtml: '<p>Summer.</p>',
    templateSuffix: null,
    sortOrder: 'MANUAL',
    updatedAt: '2026-05-01T00:00:00Z',
    image: null,
    seo: { title: null, description: null },
    ruleSet: null,
    products: {
      edges: [
        { node: { id: 'gid://shopify/Product/1', handle: 'tee' } },
        { node: { id: 'gid://shopify/Product/2', handle: 'mug' } },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    ...overrides,
  };
}

function makeSmartCollectionNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gid://shopify/Collection/201',
    handle: 'on-sale',
    title: 'On Sale',
    descriptionHtml: '',
    templateSuffix: null,
    sortOrder: 'BEST_SELLING',
    updatedAt: '2026-05-01T00:00:00Z',
    image: {
      id: 'gid://shopify/CollectionImage/1',
      url: 'https://cdn.shopify.com/s/files/1/0001/0002/collections/on-sale.jpg',
      altText: null,
    },
    seo: { title: 'Sale', description: null },
    ruleSet: {
      appliedDisjunctively: false,
      rules: [{ column: 'IS_PRICE_REDUCED', relation: 'EQUALS', condition: 'true' }],
    },
    products: {
      edges: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    ...overrides,
  };
}

function makePage(
  nodes: Array<Record<string, unknown>>,
  pageInfo: { hasNextPage: boolean; endCursor: string | null },
) {
  return {
    collections: {
      edges: nodes.map((node) => ({ node })),
      pageInfo,
    },
  };
}

function fakeClient() {
  const request = vi.fn();
  return { request, client: { request } as unknown as Requester };
}

describe('fetchCollections', () => {
  it('paginates and yields both custom and smart collections', async () => {
    const { request, client } = fakeClient();
    request
      .mockResolvedValueOnce(
        makePage([makeCustomCollectionNode()], { hasNextPage: true, endCursor: 'c1' }),
      )
      .mockResolvedValueOnce(
        makePage([makeSmartCollectionNode()], { hasNextPage: false, endCursor: null }),
      );

    const collected = [];
    for await (const c of fetchCollections(client)) collected.push(c);

    expect(collected).toHaveLength(2);
    expect(collected[0]?.ruleSet).toBeNull();
    expect(collected[0]?.products).toHaveLength(2);
    expect(collected[1]?.ruleSet?.rules[0]?.column).toBe('IS_PRICE_REDUCED');
    expect(collected[1]?.products).toEqual([]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(2, expect.any(String), { cursor: 'c1' });
  });

  it('paginates nested members via the continuation query when a collection exceeds the member page size', async () => {
    const { request, client } = fakeClient();
    const overflowing = makeCustomCollectionNode({
      products: {
        edges: [{ node: { id: 'gid://shopify/Product/1', handle: 'tee' } }],
        pageInfo: { hasNextPage: true, endCursor: 'p1' },
      },
    });
    request
      .mockResolvedValueOnce(
        makePage([overflowing], { hasNextPage: false, endCursor: null }),
      )
      .mockResolvedValueOnce({
        collection: {
          products: {
            edges: [
              { node: { id: 'gid://shopify/Product/2', handle: 'mug' } },
              { node: { id: 'gid://shopify/Product/3', handle: 'cap' } },
            ],
            pageInfo: { hasNextPage: true, endCursor: 'p2' },
          },
        },
      })
      .mockResolvedValueOnce({
        collection: {
          products: {
            edges: [{ node: { id: 'gid://shopify/Product/4', handle: 'sock' } }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });

    const collected = [];
    for await (const c of fetchCollections(client)) collected.push(c);

    expect(collected).toHaveLength(1);
    expect(collected[0]?.products.map((p) => p.id)).toEqual([
      'gid://shopify/Product/1',
      'gid://shopify/Product/2',
      'gid://shopify/Product/3',
      'gid://shopify/Product/4',
    ]);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenNthCalledWith(2, expect.any(String), {
      collectionId: 'gid://shopify/Collection/200',
      cursor: 'p1',
    });
    expect(request).toHaveBeenNthCalledWith(3, expect.any(String), {
      collectionId: 'gid://shopify/Collection/200',
      cursor: 'p2',
    });
  });

  it('rejects an unknown sortOrder via Zod', async () => {
    const { request, client } = fakeClient();
    const malformed = makeCustomCollectionNode({ sortOrder: 'RANDOM' });
    request.mockResolvedValueOnce(
      makePage([malformed], { hasNextPage: false, endCursor: null }),
    );

    await expect(async () => {
      for await (const _ of fetchCollections(client)) {
        void _;
      }
    }).rejects.toThrow();
  });
});
