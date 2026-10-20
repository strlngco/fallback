import { describe, expect, it } from 'vitest';

import type { AuthCredentials } from '../auth';
import { ShopifyAuthError, ShopifyClient, ShopifyGraphQLError } from '../client';
import { ShopifyNetworkError } from '../auth';
import { ShopifyConfigError } from '../shop-domain';

const CREDENTIALS: AuthCredentials = {
  shopDomain: 'example.myshopify.com',
  clientId: 'cid',
  clientSecret: 'cs',
};

interface FakeCall {
  url: string;
  init: RequestInit | undefined;
}

interface FakeFetch {
  fetch: typeof globalThis.fetch;
  calls: FakeCall[];
  on(matcher: string, handler: (call: FakeCall) => Response | Promise<Response>): void;
}

function createFakeFetch(): FakeFetch {
  const calls: FakeCall[] = [];
  const handlers = new Map<string, (call: FakeCall) => Response | Promise<Response>>();

  const fetchImpl = async (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    const call: FakeCall = { url: urlStr, init };
    calls.push(call);
    for (const [match, handler] of handlers) {
      if (urlStr.includes(match)) return handler(call);
    }
    throw new Error(`No fake fetch handler for ${urlStr}`);
  };

  return {
    fetch: fetchImpl as unknown as typeof globalThis.fetch,
    calls,
    on(matcher, handler) {
      handlers.set(matcher, handler);
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function readHeader(init: RequestInit | undefined, name: string): string | undefined {
  const headers = init?.headers;
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (Array.isArray(headers)) {
    const found = headers.find((h) => h[0]?.toLowerCase() === name.toLowerCase());
    return found?.[1];
  }
  for (const [k, v] of Object.entries(headers as Record<string, string>)) {
    if (k.toLowerCase() === name.toLowerCase()) return v;
  }
  return undefined;
}

describe('ShopifyClient', () => {
  it('refuses a shop domain that is not a myshopify.com domain', () => {
    const ff = createFakeFetch();
    expect(
      () =>
        new ShopifyClient({
          credentials: { ...CREDENTIALS, shopDomain: 'evil.example.com' },
          fetch: ff.fetch,
        }),
    ).toThrow(ShopifyConfigError);
  });

  it('refuses an API version that is not YYYY-MM or unstable', () => {
    const ff = createFakeFetch();
    expect(
      () => new ShopifyClient({ credentials: CREDENTIALS, fetch: ff.fetch, apiVersion: '2026-04/../x' }),
    ).toThrow(ShopifyConfigError);
  });

  it('exchanges credentials once then sends the GraphQL request with X-Shopify-Access-Token', async () => {
    const ff = createFakeFetch();
    ff.on('oauth/access_token', () =>
      jsonResponse({ access_token: 't_initial', expires_in: 86400, scope: '' }),
    );
    ff.on('graphql.json', () => jsonResponse({ data: { ok: true } }));

    const client = new ShopifyClient({ credentials: CREDENTIALS, fetch: ff.fetch });
    const result = await client.request<{ ok: boolean }>('{ ok }');
    expect(result).toEqual({ ok: true });

    const tokenCalls = ff.calls.filter((c) => c.url.includes('oauth/access_token'));
    const gqlCalls = ff.calls.filter((c) => c.url.includes('graphql.json'));
    expect(tokenCalls).toHaveLength(1);
    expect(gqlCalls).toHaveLength(1);
    expect(readHeader(gqlCalls[0]?.init, 'X-Shopify-Access-Token')).toBe('t_initial');
  });

  it('reuses the cached token across subsequent requests', async () => {
    const ff = createFakeFetch();
    ff.on('oauth/access_token', () =>
      jsonResponse({ access_token: 't', expires_in: 86400, scope: '' }),
    );
    ff.on('graphql.json', () => jsonResponse({ data: {} }));

    const client = new ShopifyClient({ credentials: CREDENTIALS, fetch: ff.fetch });
    await client.request('{ a }');
    await client.request('{ b }');

    expect(ff.calls.filter((c) => c.url.includes('oauth/access_token'))).toHaveLength(1);
    expect(ff.calls.filter((c) => c.url.includes('graphql.json'))).toHaveLength(2);
  });

  it('on 401, invalidates the cached token, refreshes, and retries the request once', async () => {
    const ff = createFakeFetch();
    let tokenCount = 0;
    ff.on('oauth/access_token', () => {
      tokenCount++;
      return jsonResponse({ access_token: `t${tokenCount}`, expires_in: 86400, scope: '' });
    });
    let gqlCount = 0;
    ff.on('graphql.json', () => {
      gqlCount++;
      if (gqlCount === 1) {
        return jsonResponse({ errors: [{ message: 'Invalid API key or access token' }] }, 401);
      }
      return jsonResponse({ data: { ok: true } });
    });

    const client = new ShopifyClient({ credentials: CREDENTIALS, fetch: ff.fetch });
    const result = await client.request<{ ok: boolean }>('{ ok }');

    expect(result).toEqual({ ok: true });
    expect(tokenCount).toBe(2);
    expect(gqlCount).toBe(2);
    const gqlCalls = ff.calls.filter((c) => c.url.includes('graphql.json'));
    expect(readHeader(gqlCalls[0]?.init, 'X-Shopify-Access-Token')).toBe('t1');
    expect(readHeader(gqlCalls[1]?.init, 'X-Shopify-Access-Token')).toBe('t2');
  });

  it('throws ShopifyAuthError when the post-refresh retry also 401s (bad credentials)', async () => {
    const ff = createFakeFetch();
    ff.on('oauth/access_token', () =>
      jsonResponse({ access_token: 't', expires_in: 86400, scope: '' }),
    );
    ff.on('graphql.json', () =>
      jsonResponse({ errors: [{ message: 'unauthorized' }] }, 401),
    );

    const client = new ShopifyClient({ credentials: CREDENTIALS, fetch: ff.fetch });
    await expect(client.request('{ ok }')).rejects.toBeInstanceOf(ShopifyAuthError);

    // Two graphql attempts (initial + post-refresh retry); two token exchanges.
    expect(ff.calls.filter((c) => c.url.includes('graphql.json'))).toHaveLength(2);
    expect(ff.calls.filter((c) => c.url.includes('oauth/access_token'))).toHaveLength(2);
  });

  it('uses the configured apiVersion in the GraphQL endpoint URL', async () => {
    const ff = createFakeFetch();
    ff.on('oauth/access_token', () =>
      jsonResponse({ access_token: 't', expires_in: 86400, scope: '' }),
    );
    ff.on('graphql.json', () => jsonResponse({ data: {} }));

    const client = new ShopifyClient({
      credentials: CREDENTIALS,
      apiVersion: '2026-01',
      fetch: ff.fetch,
    });
    await client.request('{ x }');
    const gqlCall = ff.calls.find((c) => c.url.includes('graphql.json'));
    expect(gqlCall?.url).toBe(
      'https://example.myshopify.com/admin/api/2026-01/graphql.json',
    );
  });
});

describe('ShopifyClient transient failures', () => {
  function tokenOk(ff: FakeFetch): void {
    ff.on('oauth/access_token', () =>
      jsonResponse({ access_token: 't', expires_in: 86400, scope: '' }),
    );
  }

  function sequence(responses: Array<() => Response | Promise<Response>>) {
    let i = 0;
    return () => {
      const next = responses[Math.min(i, responses.length - 1)]!;
      i++;
      return next();
    };
  }

  it('retries a 5xx response and returns the eventual success', async () => {
    const ff = createFakeFetch();
    tokenOk(ff);
    ff.on(
      'graphql.json',
      sequence([
        () => new Response('upstream error', { status: 502 }),
        () => jsonResponse({ data: { ok: true } }),
      ]),
    );
    const sleeps: number[] = [];
    const client = new ShopifyClient({
      credentials: CREDENTIALS,
      fetch: ff.fetch,
      sleep: async (ms) => { sleeps.push(ms); },
    });
    await expect(client.request('{ ok }')).resolves.toEqual({ ok: true });
    expect(sleeps).toHaveLength(1);
  });

  it('retries a network failure and returns the eventual success', async () => {
    const ff = createFakeFetch();
    tokenOk(ff);
    ff.on(
      'graphql.json',
      sequence([
        () => { throw new TypeError('fetch failed'); },
        () => jsonResponse({ data: { ok: true } }),
      ]),
    );
    const client = new ShopifyClient({ credentials: CREDENTIALS, fetch: ff.fetch, sleep: async () => {} });
    await expect(client.request('{ ok }')).resolves.toEqual({ ok: true });
  });

  it('gives up after maxAttempts with a ShopifyNetworkError', async () => {
    const ff = createFakeFetch();
    tokenOk(ff);
    ff.on('graphql.json', () => new Response('unavailable', { status: 503 }));
    const client = new ShopifyClient({
      credentials: CREDENTIALS,
      fetch: ff.fetch,
      maxAttempts: 3,
      sleep: async () => {},
    });
    await expect(client.request('{ ok }')).rejects.toBeInstanceOf(ShopifyNetworkError);
    expect(ff.calls.filter((c) => c.url.includes('graphql.json'))).toHaveLength(3);
  });

  it('times out a request that never answers instead of hanging', async () => {
    const ff = createFakeFetch();
    tokenOk(ff);
    ff.on(
      'graphql.json',
      (call) =>
        new Promise<Response>((_resolve, reject) => {
          call.init?.signal?.addEventListener('abort', () => reject(call.init?.signal?.reason));
        }),
    );
    const client = new ShopifyClient({
      credentials: CREDENTIALS,
      fetch: ff.fetch,
      maxAttempts: 1,
      requestTimeoutMs: 20,
    });
    const err = await client.request('{ ok }').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShopifyNetworkError);
    expect((err as Error).message).toMatch(/timed out/i);
  });

  it('waits at least as long as a 429 Retry-After header asks', async () => {
    const ff = createFakeFetch();
    tokenOk(ff);
    ff.on(
      'graphql.json',
      sequence([
        () => new Response('slow down', { status: 429, headers: { 'Retry-After': '4' } }),
        () => jsonResponse({ data: { ok: true } }),
      ]),
    );
    const sleeps: number[] = [];
    const client = new ShopifyClient({
      credentials: CREDENTIALS,
      fetch: ff.fetch,
      sleep: async (ms) => { sleeps.push(ms); },
    });
    await expect(client.request('{ ok }')).resolves.toEqual({ ok: true });
    expect(sleeps[0]).toBeGreaterThanOrEqual(4000);
  });

  it('does not retry a GraphQL error that is not transient', async () => {
    const ff = createFakeFetch();
    tokenOk(ff);
    ff.on('graphql.json', () => jsonResponse({ errors: [{ message: 'Field does not exist' }] }));
    const client = new ShopifyClient({ credentials: CREDENTIALS, fetch: ff.fetch, sleep: async () => {} });
    await expect(client.request('{ ok }')).rejects.toBeInstanceOf(ShopifyGraphQLError);
    expect(ff.calls.filter((c) => c.url.includes('graphql.json'))).toHaveLength(1);
  });
});

describe('ShopifyClient query-cost pacing', () => {
  function tokenOk(ff: FakeFetch): void {
    ff.on('oauth/access_token', () =>
      jsonResponse({ access_token: 't', expires_in: 86400, scope: '' }),
    );
  }

  function costed(data: unknown, requested: number, available: number, restoreRate = 50): Response {
    return jsonResponse({
      data,
      extensions: {
        cost: {
          requestedQueryCost: requested,
          actualQueryCost: requested,
          throttleStatus: { maximumAvailable: 1000, currentlyAvailable: available, restoreRate },
        },
      },
    });
  }

  it('waits for the bucket to refill before repeating a costly query', async () => {
    const ff = createFakeFetch();
    tokenOk(ff);
    ff.on('graphql.json', () => costed({ ok: true }, 100, 20));
    const sleeps: number[] = [];
    const client = new ShopifyClient({
      credentials: CREDENTIALS,
      fetch: ff.fetch,
      now: () => 0,
      sleep: async (ms) => { sleeps.push(ms); },
    });
    await client.request('{ ok }');
    expect(sleeps).toEqual([]);
    await client.request('{ ok }');
    // 80 points short at 50 points a second.
    expect(sleeps).toEqual([1600]);
  });

  it('counts the refill since the last response', async () => {
    const ff = createFakeFetch();
    tokenOk(ff);
    ff.on('graphql.json', () => costed({ ok: true }, 100, 20));
    let clock = 0;
    const sleeps: number[] = [];
    const client = new ShopifyClient({
      credentials: CREDENTIALS,
      fetch: ff.fetch,
      now: () => clock,
      sleep: async (ms) => { sleeps.push(ms); },
    });
    await client.request('{ ok }');
    clock += 2000;
    await client.request('{ ok }');
    expect(sleeps).toEqual([]);
  });

  it('does not wait when the bucket has room', async () => {
    const ff = createFakeFetch();
    tokenOk(ff);
    ff.on('graphql.json', () => costed({ ok: true }, 100, 900));
    const sleeps: number[] = [];
    const client = new ShopifyClient({
      credentials: CREDENTIALS,
      fetch: ff.fetch,
      now: () => 0,
      sleep: async (ms) => { sleeps.push(ms); },
    });
    await client.request('{ ok }');
    await client.request('{ ok }');
    expect(sleeps).toEqual([]);
  });

  it('waits as long as the throttled cost needs, not just the backoff', async () => {
    const ff = createFakeFetch();
    tokenOk(ff);
    let calls = 0;
    ff.on('graphql.json', () => {
      calls++;
      if (calls === 1) {
        return jsonResponse({
          errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
          extensions: {
            cost: {
              requestedQueryCost: 500,
              actualQueryCost: null,
              throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 100, restoreRate: 100 },
            },
          },
        });
      }
      return jsonResponse({ data: { ok: true } });
    });
    let clock = 0;
    const sleeps: number[] = [];
    const client = new ShopifyClient({
      credentials: CREDENTIALS,
      fetch: ff.fetch,
      now: () => clock,
      sleep: async (ms) => { sleeps.push(ms); clock += ms; },
    });
    await expect(client.request('{ ok }')).resolves.toEqual({ ok: true });
    // 400 points short at 100 a second: one 4s wait, not the 500ms backoff,
    // and no second wait before the retry since the bucket refilled meanwhile.
    expect(sleeps).toEqual([4000]);
  });
});
