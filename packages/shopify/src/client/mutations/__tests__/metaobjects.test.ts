import { describe, expect, it, vi } from 'vitest';
import type { RestoreOperation } from '@strlngco/fallback-core';
import { ShopifyUserError, type Requester } from '../../client';
import { restoreMetaobject } from '../metaobjects';

const ENTRY_ID = 'gid://shopify/Metaobject/1';

function snapshotEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ENTRY_ID,
    type: 'care_guide',
    handle: 'wool',
    displayName: 'Wool',
    updatedAt: '2026-06-01T00:00:00Z',
    fields: [
      { key: 'title', type: 'single_line_text_field', value: 'Wool care' },
      { key: 'note', type: 'multi_line_text_field', value: 'Wash cold.' },
    ],
    ...overrides,
  };
}

function op(changes: RestoreOperation['changes'], record = snapshotEntry()): RestoreOperation {
  return { resource: 'metaobjects', id: ENTRY_ID, changes, targetRecord: record };
}

describe('restoreMetaobject', () => {
  it('sends only the changed fields with snapshot values', async () => {
    const request = vi.fn(async (_doc: string, _vars?: Record<string, unknown>) => ({
      metaobjectUpdate: { metaobject: { id: ENTRY_ID }, userErrors: [] },
    }));
    const client = { request } as unknown as Requester;
    await restoreMetaobject(
      client,
      op([{ path: 'fields[note].value', before: 'Wash cold.', after: 'DRIFTED' }]),
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[1]).toEqual({
      id: ENTRY_ID,
      fields: [{ key: 'note', value: 'Wash cold.' }],
    });
  });

  it('writes a null snapshot value as an empty string', async () => {
    const request = vi.fn(async (_doc: string, _vars?: Record<string, unknown>) => ({
      metaobjectUpdate: { metaobject: { id: ENTRY_ID }, userErrors: [] },
    }));
    const client = { request } as unknown as Requester;
    const record = snapshotEntry({
      fields: [{ key: 'note', type: 'multi_line_text_field', value: null }],
    });
    await restoreMetaobject(
      client,
      op([{ path: 'fields[note].value', before: null, after: 'DRIFTED' }], record),
    );
    expect(request.mock.calls[0]?.[1]).toEqual({
      id: ENTRY_ID,
      fields: [{ key: 'note', value: '' }],
    });
  });

  it('throws ShopifyUserError on userErrors', async () => {
    const request = vi.fn(async (_doc: string, _vars?: Record<string, unknown>) => ({
      metaobjectUpdate: {
        metaobject: null,
        userErrors: [{ field: ['fields'], message: 'invalid value' }],
      },
    }));
    const client = { request } as unknown as Requester;
    await expect(
      restoreMetaobject(client, op([{ path: 'fields[note].value', before: 'a', after: 'b' }])),
    ).rejects.toBeInstanceOf(ShopifyUserError);
  });

  it('ignores changes whose key is missing from the snapshot fields', async () => {
    const request = vi.fn(async (_doc: string, _vars?: Record<string, unknown>) => ({
      metaobjectUpdate: { metaobject: { id: ENTRY_ID }, userErrors: [] },
    }));
    const client = { request } as unknown as Requester;
    await restoreMetaobject(
      client,
      op([
        { path: 'fields[note].value', before: 'Wash cold.', after: 'x' },
        { path: 'fields[vanished].value', before: 'gone', after: 'y' },
      ]),
    );
    expect(request.mock.calls[0]?.[1]).toEqual({
      id: ENTRY_ID,
      fields: [{ key: 'note', value: 'Wash cold.' }],
    });
  });
});
