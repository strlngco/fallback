import { describe, expect, it, vi } from 'vitest';
import type { RestoreOperation } from '@strlngco/fallback-core';
import { ShopifyUserError, type Requester } from '../../client';
import { restoreMetafields } from '../metafields';

function metafield(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'gid://shopify/Metafield/300',
    ownerId: 'gid://shopify/Product/1',
    ownerType: 'PRODUCT',
    namespace: 'custom',
    key: 'care_guide',
    type: 'multi_line_text_field',
    value: 'Wash cold.',
    description: null,
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

function op(record: Record<string, unknown>): RestoreOperation {
  return {
    resource: 'metafields',
    id: `${record['ownerId']}::${record['namespace']}::${record['key']}`,
    changes: [{ path: 'value', before: 'Wash cold.', after: 'Tumble dry.' }],
    targetRecord: record,
  };
}

describe('restoreMetafields', () => {
  it('sends one metafieldsSet input per op built from the snapshot record', async () => {
    const request = vi.fn(async (_doc: string, _vars?: Record<string, unknown>) => ({ metafieldsSet: { metafields: [{ id: 'x' }], userErrors: [] } }));
    const client = { request } as unknown as Requester;
    await restoreMetafields(client, [op(metafield())]);
    expect(request.mock.calls[0]?.[1]).toEqual({
      metafields: [
        {
          ownerId: 'gid://shopify/Product/1',
          namespace: 'custom',
          key: 'care_guide',
          type: 'multi_line_text_field',
          value: 'Wash cold.',
        },
      ],
    });
  });

  it('throws ShopifyUserError on userErrors', async () => {
    const request = vi.fn(async (_doc: string, _vars?: Record<string, unknown>) => ({
      metafieldsSet: { metafields: [], userErrors: [{ field: ['value'], message: 'invalid' }] },
    }));
    const client = { request } as unknown as Requester;
    await expect(restoreMetafields(client, [op(metafield())])).rejects.toBeInstanceOf(ShopifyUserError);
  });
});
