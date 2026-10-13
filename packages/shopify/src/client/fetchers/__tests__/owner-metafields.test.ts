import { describe, expect, it, vi } from 'vitest';
import type { Requester } from '../../client';
import {
  fetchCollectionMetafields,
  fetchShopMetafields,
  fetchVariantMetafields,
} from '../metafields';

function metafieldNode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'gid://shopify/Metafield/1',
    namespace: 'custom',
    key: 'material',
    type: 'single_line_text_field',
    value: 'wool',
    description: null,
    ownerType: 'PRODUCTVARIANT',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

function pageResponse(ownerField: string, nodes: unknown[]): Record<string, unknown> {
  return {
    [ownerField]: {
      ...(ownerField === 'shop' ? { id: 'gid://shopify/Shop/1' } : {}),
      metafields: {
        edges: nodes.map((node) => ({ node })),
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
  };
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

describe('owner metafield fetchers', () => {
  it('fetches variant metafields via productVariant and stamps the ownerId', async () => {
    const request = vi.fn(async (_doc: string, _vars?: Record<string, unknown>) => pageResponse('productVariant', [metafieldNode()]));
    const client = { request } as unknown as Requester;
    const out = await collect(
      fetchVariantMetafields(client, ['gid://shopify/ProductVariant/9']),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.ownerId).toBe('gid://shopify/ProductVariant/9');
    const doc = request.mock.calls[0]?.[0] as string;
    expect(doc).toContain('FallbackProductVariantMetafieldsPage');
    expect(doc).toContain('productVariant(id: $ownerId)');
  });

  it('fetches collection metafields via collection', async () => {
    const request = vi.fn(async (_doc: string, _vars?: Record<string, unknown>) =>
      pageResponse('collection', [metafieldNode({ ownerType: 'COLLECTION' })]),
    );
    const client = { request } as unknown as Requester;
    const out = await collect(
      fetchCollectionMetafields(client, ['gid://shopify/Collection/5']),
    );
    expect(out[0]?.ownerId).toBe('gid://shopify/Collection/5');
  });

  it('fetches shop metafields with the shop id as ownerId', async () => {
    const request = vi.fn(async (_doc: string, _vars?: Record<string, unknown>) => pageResponse('shop', [metafieldNode({ ownerType: 'SHOP' })]));
    const client = { request } as unknown as Requester;
    const out = await collect(fetchShopMetafields(client));
    expect(out).toHaveLength(1);
    expect(out[0]?.ownerId).toBe('gid://shopify/Shop/1');
  });

  it('yields nothing when the owner no longer exists', async () => {
    const request = vi.fn(async (_doc: string, _vars?: Record<string, unknown>) => ({ productVariant: null }));
    const client = { request } as unknown as Requester;
    const out = await collect(fetchVariantMetafields(client, ['gid://shopify/ProductVariant/9']));
    expect(out).toEqual([]);
  });
});
