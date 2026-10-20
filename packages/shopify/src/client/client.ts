import { ClientError, GraphQLClient } from 'graphql-request';
import type { ZodIssue } from 'zod';

import {
  ShopifyNetworkError,
  TokenManager,
  type AccessTokenCache,
  type AuthCredentials,
  type TokenManagerOptions,
} from './auth';
import { assertApiVersion, assertShopDomain } from './shop-domain';

export const SHOPIFY_API_VERSION = '2026-04';

const DEFAULT_MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8000;
// Generous because a single page of products with variants can be slow on a
// large store; the point is to fail a dead connection, not a busy one.
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const MAX_RETRY_AFTER_MS = 60_000;

export class ShopifyAuthError extends Error {
  override readonly name = 'ShopifyAuthError';
}

export class ShopifyThrottledError extends Error {
  override readonly name = 'ShopifyThrottledError';
  readonly retryAfterMs: number | undefined;

  constructor(message: string, options?: ErrorOptions & { retryAfterMs?: number | undefined }) {
    super(message, options);
    this.retryAfterMs = options?.retryAfterMs;
  }
}

export class ShopifyGraphQLError extends Error {
  override readonly name = 'ShopifyGraphQLError';
}

export class ShopifyAccessDeniedError extends Error {
  override readonly name = 'ShopifyAccessDeniedError';
}

export interface ShopifyValidationErrorInit {
  fetcher: string;
  pathPrefix: readonly (string | number)[];
  issues: ZodIssue[];
  rawValue: unknown;
}

export class ShopifyValidationError extends Error {
  override readonly name = 'ShopifyValidationError';
  readonly fetcher: string;
  readonly pathPrefix: readonly (string | number)[];
  readonly issues: ZodIssue[];
  readonly rawValue: unknown;

  constructor(init: ShopifyValidationErrorInit) {
    const first = init.issues[0];
    const summary = first
      ? `${[...init.pathPrefix, ...first.path].map(String).join('.')}: ${first.message}`
      : `${init.issues.length} issue(s)`;
    super(`Schema validation failed in ${init.fetcher} fetcher (${summary}).`);
    this.fetcher = init.fetcher;
    this.pathPrefix = init.pathPrefix;
    this.issues = init.issues;
    this.rawValue = init.rawValue;
  }
}

export interface ShopifyUserErrorEntry {
  field: string[] | null;
  message: string;
}

export class ShopifyUserError extends Error {
  override readonly name = 'ShopifyUserError';
  readonly mutation: string;
  readonly userErrors: ShopifyUserErrorEntry[];

  constructor(mutation: string, userErrors: ShopifyUserErrorEntry[]) {
    const summary = userErrors
      .map((e) => `${(e.field ?? []).join('.') || '<form>'}: ${e.message}`)
      .join('; ');
    super(`${mutation} reported user errors: ${summary}`);
    this.mutation = mutation;
    this.userErrors = userErrors;
  }
}

export interface ShopifyClientOptions {
  credentials: AuthCredentials;
  apiVersion?: string;
  maxAttempts?: number;
  fetch?: typeof globalThis.fetch;
  tokenCache?: AccessTokenCache;
  requestTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface Requester {
  request<T>(document: string, variables?: Record<string, unknown>): Promise<T>;
}

export interface ScopedRequester extends Requester {
  getGrantedScopes(): Promise<string[]>;
}

export class ShopifyClient implements Requester {
  private readonly graphql: GraphQLClient;
  private readonly tokenManager: TokenManager;
  private readonly maxAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly requestTimeoutMs: number;
  // Shopify's leaky-bucket state as of the last response, and the last
  // requested cost of each document, so the next request can wait for enough
  // points to refill instead of being throttled and backing off.
  private bucket: { available: number; maximum: number; restoreRate: number; at: number } | undefined;
  private readonly lastCost = new Map<string, number>();

  constructor(options: ShopifyClientOptions) {
    const apiVersion = options.apiVersion ?? SHOPIFY_API_VERSION;
    assertShopDomain(options.credentials.shopDomain);
    assertApiVersion(apiVersion);
    const endpoint = `https://${options.credentials.shopDomain}/admin/api/${apiVersion}/graphql.json`;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const timedFetch = withTimeout(options.fetch ?? globalThis.fetch, this.requestTimeoutMs);
    this.graphql = new GraphQLClient(endpoint, { fetch: timedFetch });
    const managerOptions: TokenManagerOptions = {
      credentials: options.credentials,
      fetch: timedFetch,
    };
    if (options.tokenCache !== undefined) managerOptions.cache = options.tokenCache;
    this.tokenManager = new TokenManager(managerOptions);
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.sleep = options.sleep ?? sleep;
    this.now = options.now ?? Date.now;
  }

  async getGrantedScopes(): Promise<string[]> {
    return this.tokenManager.getGrantedScopes();
  }

  async request<T>(document: string, variables?: Record<string, unknown>): Promise<T> {
    try {
      return await this.requestWithThrottleRetry(document, variables);
    } catch (err) {
      // One-shot auth refresh: stale CCG tokens after a long-running process produce 401.
      // Don't stack this with throttle backoff — if the retry itself rate-limits, surface that.
      if (err instanceof ShopifyAuthError) {
        this.tokenManager.invalidate();
        return await this.singleAttempt<T>(document, variables);
      }
      throw err;
    }
  }

  private async requestWithThrottleRetry<T>(
    document: string,
    variables: Record<string, unknown> | undefined,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.singleAttempt<T>(document, variables);
      } catch (err) {
        const transient = err instanceof ShopifyThrottledError || err instanceof ShopifyNetworkError;
        if (transient && attempt < this.maxAttempts - 1) {
          const retryAfterMs = err instanceof ShopifyThrottledError ? (err.retryAfterMs ?? 0) : 0;
          await this.sleep(Math.min(Math.max(backoffDelayMs(attempt), retryAfterMs), MAX_RETRY_AFTER_MS));
          continue;
        }
        throw err;
      }
    }
  }

  private async singleAttempt<T>(
    document: string,
    variables: Record<string, unknown> | undefined,
  ): Promise<T> {
    await this.waitForBudget(document);
    const token = await this.tokenManager.getToken();
    try {
      const response = await this.graphql.rawRequest<T>({
        query: document,
        ...(variables !== undefined ? { variables } : {}),
        requestHeaders: { 'X-Shopify-Access-Token': token },
      });
      this.recordCost(document, response.extensions);
      return response.data;
    } catch (err) {
      if (err instanceof ClientError) {
        this.recordCost(document, err.response.extensions);
        throw mapError(err);
      }
      throw networkError(err, this.requestTimeoutMs);
    }
  }

  private recordCost(document: string, extensions: unknown): void {
    const cost = readQueryCost(extensions);
    if (cost === undefined) return;
    this.lastCost.set(document, cost.requestedQueryCost);
    this.bucket = {
      available: cost.throttleStatus.currentlyAvailable,
      maximum: cost.throttleStatus.maximumAvailable,
      restoreRate: cost.throttleStatus.restoreRate,
      at: this.now(),
    };
  }

  private async waitForBudget(document: string): Promise<void> {
    const cost = this.lastCost.get(document);
    const bucket = this.bucket;
    if (cost === undefined || bucket === undefined || bucket.restoreRate <= 0) return;
    const elapsedSeconds = Math.max(0, this.now() - bucket.at) / 1000;
    const available = Math.min(bucket.maximum, bucket.available + elapsedSeconds * bucket.restoreRate);
    if (available >= cost) return;
    const waitMs = Math.ceil(((cost - available) / bucket.restoreRate) * 1000);
    await this.sleep(Math.min(waitMs, MAX_RETRY_AFTER_MS));
  }
}

interface QueryCost {
  requestedQueryCost: number;
  throttleStatus: { maximumAvailable: number; currentlyAvailable: number; restoreRate: number };
}

function readQueryCost(extensions: unknown): QueryCost | undefined {
  const cost = (extensions as { cost?: Partial<QueryCost> } | undefined)?.cost;
  const status = cost?.throttleStatus;
  const numbers = [
    cost?.requestedQueryCost,
    status?.maximumAvailable,
    status?.currentlyAvailable,
    status?.restoreRate,
  ];
  if (!numbers.every((n) => typeof n === 'number' && Number.isFinite(n))) return undefined;
  return cost as QueryCost;
}

// How long until the bucket holds what the throttled request asked for.
function costRetryAfterMs(err: ClientError): number | undefined {
  const cost = readQueryCost(err.response.extensions);
  if (cost === undefined || cost.throttleStatus.restoreRate <= 0) return undefined;
  const missing = cost.requestedQueryCost - cost.throttleStatus.currentlyAvailable;
  return missing > 0 ? Math.ceil((missing / cost.throttleStatus.restoreRate) * 1000) : 0;
}

function withTimeout(base: typeof globalThis.fetch, timeoutMs: number): typeof globalThis.fetch {
  return (input, init) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return base(input, { ...init, signal });
  };
}

function networkError(err: unknown, timeoutMs: number): Error {
  if (err instanceof ShopifyNetworkError) return err;
  if (err instanceof Error && err.name === 'TimeoutError') {
    return new ShopifyNetworkError(`Request to Shopify timed out after ${timeoutMs / 1000}s.`, {
      cause: err,
    });
  }
  if (err instanceof Error) {
    return new ShopifyNetworkError(`Request to Shopify failed: ${err.message}`, { cause: err });
  }
  return new ShopifyNetworkError(`Request to Shopify failed: ${String(err)}`);
}

export function mapError(err: unknown): Error {
  if (err instanceof ClientError) {
    const status = err.response.status;
    if (status === 401 || status === 403) {
      return new ShopifyAuthError(
        'Shopify rejected the access token. Verify SHOPIFY_CLIENT_ID/SHOPIFY_CLIENT_SECRET and the app scopes.',
        { cause: err },
      );
    }
    const errors = err.response.errors ?? [];
    const throttled =
      status === 429 ||
      errors.some((e) => (e.extensions as { code?: string } | undefined)?.code === 'THROTTLED');
    if (throttled) {
      return new ShopifyThrottledError(
        'Shopify throttled the request and backoff was exhausted before the limit cleared.',
        { cause: err, retryAfterMs: maxDefined(retryAfterMs(err), costRetryAfterMs(err)) },
      );
    }
    if (status >= 500) {
      return new ShopifyNetworkError(`Shopify returned HTTP ${status}.`, { cause: err });
    }
    const denied = errors.filter(
      (e) => (e.extensions as { code?: string } | undefined)?.code === 'ACCESS_DENIED',
    );
    if (denied.length > 0) {
      return new ShopifyAccessDeniedError(denied.map((e) => e.message).join('; '), { cause: err });
    }
    const summary = errors.map((e) => e.message).join('; ');
    return new ShopifyGraphQLError(
      summary || `Shopify GraphQL request failed (HTTP ${status}).`,
      { cause: err },
    );
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}

function retryAfterMs(err: ClientError): number | undefined {
  const headers = (err.response as { headers?: Headers }).headers;
  const raw = headers?.get?.('Retry-After');
  if (raw === null || raw === undefined) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

function maxDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

function backoffDelayMs(attempt: number): number {
  return Math.min(2 ** attempt * BASE_BACKOFF_MS, MAX_BACKOFF_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
