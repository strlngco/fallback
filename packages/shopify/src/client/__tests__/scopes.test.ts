import { describe, expect, it, vi } from 'vitest';
import { TokenManager, type AuthCredentials } from '../auth';

const CREDS: AuthCredentials = {
  shopDomain: 'example.myshopify.com',
  clientId: 'cid',
  clientSecret: 'cs',
};

function fakeFetch(scope: string): typeof globalThis.fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify({ access_token: 'shpat_x', expires_in: 3600, scope }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ) as unknown as typeof globalThis.fetch;
}

describe('TokenManager.getGrantedScopes', () => {
  it('parses a comma-separated scope string into a list', async () => {
    const tm = new TokenManager({ credentials: CREDS, fetch: fakeFetch('read_products,write_products') });
    expect(await tm.getGrantedScopes()).toEqual(['read_products', 'write_products']);
  });

  it('parses whitespace-separated scopes and drops empties', async () => {
    const tm = new TokenManager({ credentials: CREDS, fetch: fakeFetch('read_products  write_products ') });
    expect(await tm.getGrantedScopes()).toEqual(['read_products', 'write_products']);
  });

  it('does not exchange twice when a token was already fetched', async () => {
    const fetchImpl = fakeFetch('write_products');
    const tm = new TokenManager({ credentials: CREDS, fetch: fetchImpl });
    await tm.getToken();
    await tm.getGrantedScopes();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('re-fetches scopes after invalidate() instead of returning stale data', async () => {
    const fetchImpl = fakeFetch('read_products');
    const tm = new TokenManager({ credentials: CREDS, fetch: fetchImpl });
    await tm.getGrantedScopes();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    tm.invalidate();
    await tm.getGrantedScopes();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
