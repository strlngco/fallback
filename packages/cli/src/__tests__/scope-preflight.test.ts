import { describe, expect, it, vi } from 'vitest';

import type { ScopedRequester } from '@strlngco/fallback-shopify';

import { ScopeError } from '../env';
import { assertMetaobjectReadScopes } from '../scope-preflight';

function fakeClient(granted: string[]): ScopedRequester {
  return {
    request: vi.fn(),
    getGrantedScopes: vi.fn(async () => granted),
  } as unknown as ScopedRequester;
}

const CAPTURE_CONTEXT = {
  verb: 'Capturing',
  scopeWorkaround: 'products,collections,metafields,inventory-levels',
};

describe('assertMetaobjectReadScopes', () => {
  it('resolves without error when both scopes are granted', async () => {
    const client = fakeClient(['read_products', 'read_metaobjects', 'read_metaobject_definitions']);
    await expect(assertMetaobjectReadScopes(client, CAPTURE_CONTEXT)).resolves.toBeUndefined();
  });

  it('throws a ScopeError naming both scopes when neither is granted', async () => {
    const client = fakeClient(['read_products']);
    await expect(assertMetaobjectReadScopes(client, CAPTURE_CONTEXT)).rejects.toThrow(ScopeError);
    await expect(assertMetaobjectReadScopes(client, CAPTURE_CONTEXT)).rejects.toThrow(
      /read_metaobjects and read_metaobject_definitions/,
    );
  });

  it('throws a ScopeError naming what was granted when only one scope is present', async () => {
    const client = fakeClient(['read_metaobjects']);
    let error: unknown;
    try {
      await assertMetaobjectReadScopes(client, CAPTURE_CONTEXT);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ScopeError);
    const message = (error as Error).message;
    expect(message).toContain('Capturing metaobjects requires');
    expect(message).toContain('read_metaobjects and read_metaobject_definitions');
    expect(message).toContain('the app was granted: read_metaobjects');
    expect(message).toContain('--scope products,collections,metafields,inventory-levels');
  });

  it('names "none" when the app was granted no scopes at all', async () => {
    const client = fakeClient([]);
    let error: unknown;
    try {
      await assertMetaobjectReadScopes(client, CAPTURE_CONTEXT);
    } catch (err) {
      error = err;
    }
    expect((error as Error).message).toContain('but the app was granted: none');
  });

  it('passes when write_metaobjects is granted in place of read_metaobjects', async () => {
    const client = fakeClient(['write_metaobjects', 'read_metaobject_definitions']);
    await expect(assertMetaobjectReadScopes(client, CAPTURE_CONTEXT)).resolves.toBeUndefined();
  });

  it('still fails when only write_metaobjects is granted and definitions scope is absent', async () => {
    const client = fakeClient(['write_metaobjects']);
    let error: unknown;
    try {
      await assertMetaobjectReadScopes(client, CAPTURE_CONTEXT);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ScopeError);
    const message = (error as Error).message;
    expect(message).toContain('read_metaobjects and read_metaobject_definitions');
    expect(message).toContain('the app was granted: write_metaobjects');
  });

  it('uses the restore verb and scope workaround when given a restore context', async () => {
    const client = fakeClient(['read_products']);
    let error: unknown;
    try {
      await assertMetaobjectReadScopes(client, { verb: 'Restoring', scopeWorkaround: 'products,metafields' });
    } catch (err) {
      error = err;
    }
    const message = (error as Error).message;
    expect(message).toContain('Restoring metaobjects requires');
    expect(message).toContain('--scope products,metafields');
    expect(message).not.toContain('inventory-levels');
  });
});
