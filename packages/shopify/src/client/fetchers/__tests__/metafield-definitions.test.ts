import { describe, expect, it, vi } from 'vitest';
import type { Requester } from '../../client';
import {
  CONTENT_METAFIELD_OWNER_TYPES,
  fetchMetafieldDefinitions,
} from '../metafield-definitions';

function definitionNode(): Record<string, unknown> {
  return {
    id: 'gid://shopify/MetafieldDefinition/1',
    ownerType: 'PRODUCT',
    namespace: 'custom',
    key: 'material',
    name: 'Material',
    description: null,
    type: { name: 'single_line_text_field' },
    validations: [{ name: 'max', type: 'integer', value: '80' }],
  };
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

describe('fetchMetafieldDefinitions', () => {
  it('queries once per owner type and flattens type.name', async () => {
    const request = vi.fn(async (_doc: string, vars: Record<string, unknown>) => ({
      metafieldDefinitions: {
        edges: vars['ownerType'] === 'PRODUCT' ? [{ node: definitionNode() }] : [],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    }));
    const client = { request } as unknown as Requester;
    const out = await collect(fetchMetafieldDefinitions(client, ['PRODUCT', 'SHOP']));
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map((c) => (c[1] as Record<string, unknown>)['ownerType'])).toEqual([
      'PRODUCT',
      'SHOP',
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe('single_line_text_field');
  });

  it('exports the covered owner types in capture order', () => {
    expect(CONTENT_METAFIELD_OWNER_TYPES).toEqual(['PRODUCT', 'PRODUCTVARIANT', 'COLLECTION', 'SHOP']);
  });
});
