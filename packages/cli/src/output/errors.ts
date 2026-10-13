import {
  ShopifyAccessDeniedError,
  ShopifyAuthError,
  ShopifyAuthExchangeError,
  ShopifyConfigError,
  ShopifyGraphQLError,
  ShopifyNetworkError,
  ShopifyThrottledError,
  ShopifyUserError,
  ShopifyValidationError,
} from '@strlngco/fallback-shopify';

import {
  InvalidOptionError,
  MissingEnvError,
  ScopeError,
  SnapshotNotFoundError,
} from '../env';

export function mapErrorForReport(err: unknown): { exitCode: number; message: string } {
  if (err instanceof ShopifyAuthError) {
    return { exitCode: 1, message: `Shopify rejected the access token. ${err.message}` };
  }
  if (err instanceof ShopifyAuthExchangeError) {
    return {
      exitCode: 1,
      message: `Shopify rejected the client credentials exchange. ${err.message}`,
    };
  }
  if (
    err instanceof ShopifyConfigError ||
    err instanceof MissingEnvError ||
    err instanceof ScopeError ||
    err instanceof InvalidOptionError ||
    err instanceof SnapshotNotFoundError
  ) {
    return { exitCode: 1, message: err.message };
  }
  if (err instanceof ShopifyNetworkError) {
    return { exitCode: 2, message: err.message };
  }
  if (err instanceof ShopifyThrottledError) {
    return { exitCode: 2, message: `Shopify throttled the request. ${err.message}` };
  }
  if (err instanceof ShopifyValidationError) {
    return { exitCode: 2, message: formatValidationError(err) };
  }
  if (err instanceof ShopifyUserError) {
    return { exitCode: 2, message: `Shopify rejected the write. ${err.message}` };
  }
  if (err instanceof ShopifyAccessDeniedError) {
    return {
      exitCode: 1,
      message:
        `Shopify denied access: ${err.message} ` +
        `Grant the required scope to the app in the Shopify Dev Dashboard, ` +
        `or narrow --scope to exclude the resource.`,
    };
  }
  if (err instanceof ShopifyGraphQLError) {
    return { exitCode: 2, message: `Shopify GraphQL error: ${err.message}` };
  }
  if (err instanceof Error) {
    return { exitCode: 2, message: `Operational error: ${err.message}` };
  }
  return { exitCode: 2, message: `Operational error: ${String(err)}` };
}

export function writeError(
  stream: { write(s: string): unknown },
  err: unknown,
  json: boolean,
): number {
  const { exitCode, message } = mapErrorForReport(err);
  if (json) {
    stream.write(JSON.stringify({ error: message, exitCode }) + '\n');
  } else {
    stream.write(`fallback: ${message}\n`);
  }
  return exitCode;
}

const MAX_VALUE_PREVIEW = 200;
const MAX_RECORD_PREVIEW = 200;

function formatValidationError(err: ShopifyValidationError): string {
  const lines = [`Schema validation failed while running the ${err.fetcher} fetcher.`];
  for (const issue of err.issues) {
    const fullPath = [...err.pathPrefix, ...issue.path].map(String).join('.');
    const value = extractValueAtPath(err.rawValue, issue.path);
    const valuePreview =
      value === undefined ? '<missing>' : truncate(safeJsonStringify(value), MAX_VALUE_PREVIEW);
    lines.push(`  ${fullPath}: ${issue.message} (got: ${valuePreview})`);
  }
  lines.push(`Record (truncated): ${truncate(safeJsonStringify(err.rawValue), MAX_RECORD_PREVIEW)}`);
  return lines.join('\n');
}

function extractValueAtPath(root: unknown, path: readonly (string | number)[]): unknown {
  let current: unknown = root;
  for (const key of path) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[String(key)];
  }
  return current;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '…';
}
