import { describe, expect, it, vi } from 'vitest';
import type { Requester } from '../../client';
import { METAOBJECT_READ_SCOPES, fetchMetaobjectDefinitions, fetchMetaobjects } from '../metaobjects';

function definitionNode(): Record<string, unknown> {
  return {
    id: 'gid://shopify/MetaobjectDefinition/1',
    type: 'care_guide',
    name: 'Care guide',
    description: null,
    displayNameKey: 'title',
    fieldDefinitions: [
      {
        key: 'title',
        name: 'Title',
        description: null,
        required: true,
        type: { name: 'single_line_text_field' },
        validations: [],
      },
    ],
  };
}

function entryNode(): Record<string, unknown> {
  return {
    id: 'gid://shopify/Metaobject/10',
    type: 'care_guide',
    handle: 'wool-care',
    displayName: 'Wool care',
    updatedAt: '2026-06-01T00:00:00Z',
    fields: [{ key: 'title', type: 'single_line_text_field', value: 'Wool care' }],
  };
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

describe('metaobject fetchers', () => {
  it('fetches definitions and flattens field definition types', async () => {
    const request = vi.fn(async () => ({
      metaobjectDefinitions: {
        edges: [{ node: definitionNode() }],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    }));
    const client = { request } as unknown as Requester;
    const out = await collect(fetchMetaobjectDefinitions(client));
    expect(out).toHaveLength(1);
    expect(out[0]?.fieldDefinitions[0]?.type).toBe('single_line_text_field');
  });

  it('fetches entries once per definition type', async () => {
    const request = vi.fn(async (_doc: string, vars: Record<string, unknown>) => ({
      metaobjects: {
        edges: vars['type'] === 'care_guide' ? [{ node: entryNode() }] : [],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    }));
    const client = { request } as unknown as Requester;
    const out = await collect(fetchMetaobjects(client, ['care_guide', 'size_chart']));
    expect(request).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(1);
    expect(out[0]?.handle).toBe('wool-care');
  });

  it('exports the two read scopes metaobject queries require', () => {
    expect(METAOBJECT_READ_SCOPES).toEqual(['read_metaobjects', 'read_metaobject_definitions']);
  });
});
