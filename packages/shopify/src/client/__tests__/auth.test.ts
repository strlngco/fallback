import { describe, expect, it, vi } from 'vitest';

import {
  InMemoryAccessTokenCache,
  ShopifyAuthExchangeError,
  ShopifyNetworkError,
  TokenManager,
  exchangeForToken,
  scopeIsGranted,
  type AuthCredentials,
} from '../auth';
import { ShopifyConfigError } from '../shop-domain';

const CREDENTIALS: AuthCredentials = {
  shopDomain: 'example.myshopify.com',
  clientId: 'cid_abc',
  clientSecret: 'cs_xyz',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain' },
  });
}

describe('exchangeForToken', () => {
  it('POSTs to the shop oauth endpoint with the credentials and grant_type=client_credentials', async () => {
    const fakeFetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ access_token: 'shpat_x', expires_in: 86400, scope: 'read_products' }),
      );
    await exchangeForToken(CREDENTIALS, fakeFetch as unknown as typeof globalThis.fetch);

    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const call = fakeFetch.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe('https://example.myshopify.com/admin/oauth/access_token');
    expect(call[1]?.method).toBe('POST');
    const body = JSON.parse(call[1]?.body as string) as Record<string, string>;
    expect(body).toEqual({
      client_id: 'cid_abc',
      client_secret: 'cs_xyz',
      grant_type: 'client_credentials',
    });
  });

  it('parses access_token, expires_in, and scope from a successful response', async () => {
    const before = Date.now();
    const fakeFetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({
          access_token: 'shpat_x',
          expires_in: 86400,
          scope: 'read_products,write_products',
        }),
      );
    const result = await exchangeForToken(
      CREDENTIALS,
      fakeFetch as unknown as typeof globalThis.fetch,
    );
    expect(result.accessToken).toBe('shpat_x');
    expect(result.scope).toBe('read_products,write_products');
    const expectedExpiryMs = before + 86400 * 1000;
    const drift = Math.abs(result.expiresAt.getTime() - expectedExpiryMs);
    expect(drift).toBeLessThan(1000);
  });

  it('throws ShopifyAuthExchangeError on HTTP 401 with the response body attached', async () => {
    const fakeFetch = vi
      .fn()
      .mockResolvedValue(textResponse('invalid_client: client authentication failed', 401));
    let caught: unknown;
    try {
      await exchangeForToken(CREDENTIALS, fakeFetch as unknown as typeof globalThis.fetch);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ShopifyAuthExchangeError);
    const err = caught as ShopifyAuthExchangeError;
    expect(err.responseStatus).toBe(401);
    expect(err.responseBody).toBe('invalid_client: client authentication failed');
    expect(err.message).toContain('invalid_client');
  });

  it('throws ShopifyAuthExchangeError on malformed JSON response', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(textResponse('not json', 200));
    await expect(
      exchangeForToken(CREDENTIALS, fakeFetch as unknown as typeof globalThis.fetch),
    ).rejects.toBeInstanceOf(ShopifyAuthExchangeError);
  });

  it('reports a network failure as ShopifyNetworkError naming the host, not as a rejection', async () => {
    const fakeFetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const err = await exchangeForToken(
      CREDENTIALS,
      fakeFetch as unknown as typeof globalThis.fetch,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShopifyNetworkError);
    expect(err).not.toBeInstanceOf(ShopifyAuthExchangeError);
    expect((err as Error).message).toContain('example.myshopify.com');
  });

  it('refuses to send credentials to a host that is not a myshopify.com domain', async () => {
    const fakeFetch = vi.fn();
    await expect(
      exchangeForToken(
        { ...CREDENTIALS, shopDomain: 'evil.example.com' },
        fakeFetch as unknown as typeof globalThis.fetch,
      ),
    ).rejects.toBeInstanceOf(ShopifyConfigError);
    expect(fakeFetch).not.toHaveBeenCalled();
  });
});

describe('TokenManager', () => {
  it('returns the cached token when it is well outside the expiry buffer', async () => {
    const cache = new InMemoryAccessTokenCache();
    cache.set('cached', new Date(Date.now() + 60 * 60 * 1000));
    const fakeFetch = vi.fn();
    const manager = new TokenManager({
      credentials: CREDENTIALS,
      cache,
      fetch: fakeFetch as unknown as typeof globalThis.fetch,
    });
    const token = await manager.getToken();
    expect(token).toBe('cached');
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it('triggers a fresh exchange when the cache is empty', async () => {
    const fakeFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: 'fresh', expires_in: 86400, scope: '' }));
    const manager = new TokenManager({
      credentials: CREDENTIALS,
      fetch: fakeFetch as unknown as typeof globalThis.fetch,
    });
    const token = await manager.getToken();
    expect(token).toBe('fresh');
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it('triggers a fresh exchange when the cached token is within 60s of expiry', async () => {
    const cache = new InMemoryAccessTokenCache();
    // 30s from now — inside the 60s buffer.
    cache.set('stale', new Date(Date.now() + 30 * 1000));
    const fakeFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: 'fresh', expires_in: 86400, scope: '' }));
    const manager = new TokenManager({
      credentials: CREDENTIALS,
      cache,
      fetch: fakeFetch as unknown as typeof globalThis.fetch,
    });
    const token = await manager.getToken();
    expect(token).toBe('fresh');
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it('triggers a fresh exchange when the cached token is already expired', async () => {
    const cache = new InMemoryAccessTokenCache();
    cache.set('expired', new Date(Date.now() - 1000));
    const fakeFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: 'fresh', expires_in: 86400, scope: '' }));
    const manager = new TokenManager({
      credentials: CREDENTIALS,
      cache,
      fetch: fakeFetch as unknown as typeof globalThis.fetch,
    });
    expect(await manager.getToken()).toBe('fresh');
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it('invalidate() clears the cache so the next call re-exchanges', async () => {
    const cache = new InMemoryAccessTokenCache();
    cache.set('initial', new Date(Date.now() + 60 * 60 * 1000));
    const fakeFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: 'fresh', expires_in: 86400, scope: '' }));
    const manager = new TokenManager({
      credentials: CREDENTIALS,
      cache,
      fetch: fakeFetch as unknown as typeof globalThis.fetch,
    });
    expect(await manager.getToken()).toBe('initial');
    manager.invalidate();
    expect(await manager.getToken()).toBe('fresh');
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });
});

describe('scopeIsGranted', () => {
  it('is satisfied when the read scope itself is granted', () => {
    expect(scopeIsGranted(['read_products'], 'read_products')).toBe(true);
  });

  it('is satisfied by the corresponding write scope', () => {
    expect(scopeIsGranted(['write_metaobjects'], 'read_metaobjects')).toBe(true);
  });

  it('is not satisfied by an unrelated write scope', () => {
    expect(scopeIsGranted(['write_products'], 'read_metaobjects')).toBe(false);
  });

  it('is not satisfied for a write requirement when only the read scope is granted', () => {
    expect(scopeIsGranted(['read_products'], 'write_products')).toBe(false);
  });

  it('passes an exact-match write requirement', () => {
    expect(scopeIsGranted(['write_products'], 'write_products')).toBe(true);
  });
});

describe('InMemoryAccessTokenCache', () => {
  it('returns null when empty', () => {
    const cache = new InMemoryAccessTokenCache();
    expect(cache.get()).toBeNull();
  });

  it('stores and retrieves an entry', () => {
    const cache = new InMemoryAccessTokenCache();
    const expiresAt = new Date(Date.now() + 86400 * 1000);
    cache.set('tok', expiresAt);
    expect(cache.get()).toEqual({ accessToken: 'tok', expiresAt });
  });

  it('clear() removes the stored entry', () => {
    const cache = new InMemoryAccessTokenCache();
    cache.set('tok', new Date());
    cache.clear();
    expect(cache.get()).toBeNull();
  });
});
