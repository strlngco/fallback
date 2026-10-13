import { assertShopDomain } from './shop-domain';

const DEFAULT_EXPIRY_BUFFER_MS = 60 * 1000;

export interface AuthCredentials {
  shopDomain: string;
  clientId: string;
  clientSecret: string;
}

export interface ExchangedToken {
  accessToken: string;
  expiresAt: Date;
  scope: string;
}

export interface AccessTokenCache {
  get(): { accessToken: string; expiresAt: Date } | null;
  set(accessToken: string, expiresAt: Date): void;
  clear(): void;
}

export class InMemoryAccessTokenCache implements AccessTokenCache {
  private entry: { accessToken: string; expiresAt: Date } | null = null;

  get(): { accessToken: string; expiresAt: Date } | null {
    return this.entry;
  }

  set(accessToken: string, expiresAt: Date): void {
    this.entry = { accessToken, expiresAt };
  }

  clear(): void {
    this.entry = null;
  }
}

export interface ShopifyAuthExchangeErrorInit {
  cause?: unknown;
  responseStatus?: number;
  responseBody?: string;
}

export class ShopifyAuthExchangeError extends Error {
  override readonly name = 'ShopifyAuthExchangeError';
  readonly responseStatus: number | undefined;
  readonly responseBody: string | undefined;

  constructor(message: string, init: ShopifyAuthExchangeErrorInit = {}) {
    super(message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.responseStatus = init.responseStatus;
    this.responseBody = init.responseBody;
  }
}

// Distinct from ShopifyAuthExchangeError: Shopify never answered, so the
// credentials were not judged and the failure is operational, not the user's.
export class ShopifyNetworkError extends Error {
  override readonly name = 'ShopifyNetworkError';
}

export async function exchangeForToken(
  credentials: AuthCredentials,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<ExchangedToken> {
  assertShopDomain(credentials.shopDomain);
  const url = `https://${credentials.shopDomain}/admin/oauth/access_token`;
  const body = JSON.stringify({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    grant_type: 'client_credentials',
  });

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body,
    });
  } catch (err) {
    const reason =
      err instanceof Error && err.name === 'TimeoutError'
        ? 'the request timed out'
        : err instanceof Error
          ? err.message
          : String(err);
    throw new ShopifyNetworkError(
      `Could not reach ${credentials.shopDomain} for the client credentials exchange: ${reason}`,
      { cause: err },
    );
  }

  let bodyText = '';
  try {
    bodyText = await response.text();
  } catch {
    // ignore body-read failure; the status alone is informative enough
  }

  if (!response.ok) {
    throw new ShopifyAuthExchangeError(
      `Shopify rejected the client credentials exchange (HTTP ${response.status}). ${bodyText}`,
      { responseStatus: response.status, responseBody: bodyText },
    );
  }

  let parsed: { access_token?: unknown; expires_in?: unknown; scope?: unknown };
  try {
    parsed = JSON.parse(bodyText) as typeof parsed;
  } catch {
    throw new ShopifyAuthExchangeError(
      `Shopify returned a non-JSON token exchange response: ${bodyText.slice(0, 200)}`,
      { responseStatus: response.status, responseBody: bodyText },
    );
  }

  if (typeof parsed.access_token !== 'string' || typeof parsed.expires_in !== 'number') {
    throw new ShopifyAuthExchangeError(
      `Shopify returned a malformed token exchange response: ${JSON.stringify(parsed)}`,
      { responseStatus: response.status, responseBody: bodyText },
    );
  }

  return {
    accessToken: parsed.access_token,
    expiresAt: new Date(Date.now() + parsed.expires_in * 1000),
    scope: typeof parsed.scope === 'string' ? parsed.scope : '',
  };
}

export interface TokenManagerOptions {
  credentials: AuthCredentials;
  cache?: AccessTokenCache;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  expiryBufferMs?: number;
}

export class TokenManager {
  private readonly credentials: AuthCredentials;
  private readonly cache: AccessTokenCache;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly now: () => Date;
  private readonly expiryBufferMs: number;
  private lastScopes: string[] | null = null;

  constructor(options: TokenManagerOptions) {
    this.credentials = options.credentials;
    this.cache = options.cache ?? new InMemoryAccessTokenCache();
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
    this.expiryBufferMs = options.expiryBufferMs ?? DEFAULT_EXPIRY_BUFFER_MS;
  }

  async getToken(): Promise<string> {
    const cached = this.cache.get();
    if (cached !== null) {
      const expiresWithBuffer = cached.expiresAt.getTime() - this.expiryBufferMs;
      if (this.now().getTime() < expiresWithBuffer) {
        return cached.accessToken;
      }
    }
    const fresh = await exchangeForToken(this.credentials, this.fetchImpl);
    this.cache.set(fresh.accessToken, fresh.expiresAt);
    this.lastScopes = parseScopes(fresh.scope);
    return fresh.accessToken;
  }

  async getGrantedScopes(): Promise<string[]> {
    if (this.lastScopes === null) {
      const fresh = await exchangeForToken(this.credentials, this.fetchImpl);
      this.cache.set(fresh.accessToken, fresh.expiresAt);
      this.lastScopes = parseScopes(fresh.scope);
    }
    return this.lastScopes;
  }

  invalidate(): void {
    this.cache.clear();
    this.lastScopes = null;
  }
}

export function parseScopes(scope: string): string[] {
  return scope.split(/[,\s]+/).filter((s) => s.length > 0);
}

// Shopify write scopes imply their read counterpart: a token granted only
// write_metaobjects can execute metaobject read queries (verified live against
// 2026-04). Literal matching on the granted-scope string would fail merchants
// whose dashboard grant lists only the write scope.
export function scopeIsGranted(granted: readonly string[], required: string): boolean {
  if (granted.includes(required)) return true;
  if (required.startsWith('read_')) {
    return granted.includes(`write_${required.slice('read_'.length)}`);
  }
  return false;
}
