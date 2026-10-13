import { describe, expect, it, vi } from 'vitest';
import { type Requester } from '../../client';
import { fetchProductMetafields } from '../metafields';

function makeMetafieldNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gid://shopify/Metafield/300',
    namespace: 'custom',
    key: 'care_guide',
    type: 'multi_line_text_field',
    value: 'Wash cold.',
    description: null,
    ownerType: 'PRODUCT',
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

function makePage(
  nodes: Array<Record<string, unknown>>,
  pageInfo: { hasNextPage: boolean; endCursor: string | null },
) {
  return {
    product: {
      metafields: {
        edges: nodes.map((node) => ({ node })),
        pageInfo,
      },
    },
  };
}

function fakeClient() {
  const request = vi.fn();
  return { request, client: { request } as unknown as Requester };
}

describe('fetchProductMetafields', () => {
  it('paginates per owner and attaches the owner ID to each metafield', async () => {
    const { request, client } = fakeClient();
    request
      .mockResolvedValueOnce(
        makePage(
          [makeMetafieldNode({ id: 'gid://shopify/Metafield/300' })],
          { hasNextPage: true, endCursor: 'm1' },
        ),
      )
      .mockResolvedValueOnce(
        makePage(
          [makeMetafieldNode({ id: 'gid://shopify/Metafield/301' })],
          { hasNextPage: false, endCursor: null },
        ),
      )
      .mockResolvedValueOnce(
        makePage(
          [makeMetafieldNode({ id: 'gid://shopify/Metafield/400' })],
          { hasNextPage: false, endCursor: null },
        ),
      );

    const ownerIds = ['gid://shopify/Product/1', 'gid://shopify/Product/2'];
    const collected = [];
    for await (const m of fetchProductMetafields(client, ownerIds)) collected.push(m);

    expect(collected).toHaveLength(3);
    expect(collected[0]?.ownerId).toBe('gid://shopify/Product/1');
    expect(collected[1]?.ownerId).toBe('gid://shopify/Product/1');
    expect(collected[2]?.ownerId).toBe('gid://shopify/Product/2');

    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenNthCalledWith(1, expect.any(String), {
      ownerId: 'gid://shopify/Product/1',
      cursor: null,
    });
    expect(request).toHaveBeenNthCalledWith(2, expect.any(String), {
      ownerId: 'gid://shopify/Product/1',
      cursor: 'm1',
    });
    expect(request).toHaveBeenNthCalledWith(3, expect.any(String), {
      ownerId: 'gid://shopify/Product/2',
      cursor: null,
    });
  });

  it('yields nothing for an owner that no longer exists (product:null)', async () => {
    const { request, client } = fakeClient();
    request.mockResolvedValueOnce({ product: null });

    const collected = [];
    for await (const m of fetchProductMetafields(client, ['gid://shopify/Product/999'])) {
      collected.push(m);
    }
    expect(collected).toEqual([]);
  });

  it('rejects malformed metafield data via Zod', async () => {
    const { request, client } = fakeClient();
    request.mockResolvedValueOnce(
      makePage([makeMetafieldNode({ namespace: '' })], {
        hasNextPage: false,
        endCursor: null,
      }),
    );

    await expect(async () => {
      for await (const _ of fetchProductMetafields(client, ['gid://shopify/Product/1'])) {
        void _;
      }
    }).rejects.toThrow();
  });

  it('accepts an async iterable of owner IDs', async () => {
    const { request, client } = fakeClient();
    request.mockResolvedValueOnce(
      makePage([makeMetafieldNode()], { hasNextPage: false, endCursor: null }),
    );

    async function* owners() {
      yield 'gid://shopify/Product/1';
    }

    const collected = [];
    for await (const m of fetchProductMetafields(client, owners())) collected.push(m);
    expect(collected).toHaveLength(1);
  });
});
