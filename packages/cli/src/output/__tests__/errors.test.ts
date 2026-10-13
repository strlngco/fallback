import { describe, expect, it } from 'vitest';
import { z } from 'zod';
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
import { InvalidOptionError, MissingEnvError, ScopeError, SnapshotNotFoundError } from '../../env';
import { mapErrorForReport, writeError } from '../errors';

describe('mapErrorForReport', () => {
  it('maps a ShopifyConfigError to exit 1 with the bare message', () => {
    expect(mapErrorForReport(new ShopifyConfigError('bad domain'))).toEqual({
      exitCode: 1,
      message: 'bad domain',
    });
  });

  it('maps a ShopifyNetworkError to exit 2 without claiming Shopify rejected anything', () => {
    const r = mapErrorForReport(new ShopifyNetworkError('Could not reach x.myshopify.com: fetch failed'));
    expect(r.exitCode).toBe(2);
    expect(r.message).toBe('Could not reach x.myshopify.com: fetch failed');
  });

  it('maps user/config errors to exit 1 with the bare message', () => {
    expect(mapErrorForReport(new InvalidOptionError('bad'))).toEqual({ exitCode: 1, message: 'bad' });
    expect(mapErrorForReport(new MissingEnvError('missing', ['X']))).toEqual({
      exitCode: 1,
      message: 'missing',
    });
  });

  it('maps a ScopeError to exit 1 with the bare message', () => {
    expect(mapErrorForReport(new ScopeError('missing write_products'))).toEqual({
      exitCode: 1,
      message: 'missing write_products',
    });
  });

  it('maps a SnapshotNotFoundError to exit 1 with the bare message', () => {
    expect(mapErrorForReport(new SnapshotNotFoundError('no such snapshot'))).toEqual({
      exitCode: 1,
      message: 'no such snapshot',
    });
  });

  it('maps a ShopifyAuthError to exit 1 with a prefixed message', () => {
    const r = mapErrorForReport(new ShopifyAuthError('Token rejected.'));
    expect(r.exitCode).toBe(1);
    expect(r.message).toBe('Shopify rejected the access token. Token rejected.');
  });

  it('maps a ShopifyAuthExchangeError to exit 1 with a prefixed message', () => {
    const r = mapErrorForReport(
      new ShopifyAuthExchangeError('Shopify rejected the client credentials exchange (HTTP 401). bad creds'),
    );
    expect(r.exitCode).toBe(1);
    expect(r.message).toBe(
      'Shopify rejected the client credentials exchange. ' +
        'Shopify rejected the client credentials exchange (HTTP 401). bad creds',
    );
  });

  it('maps throttling to exit 2 with a prefixed message', () => {
    const r = mapErrorForReport(new ShopifyThrottledError('slow down'));
    expect(r.exitCode).toBe(2);
    expect(r.message).toBe('Shopify throttled the request. slow down');
  });

  it('maps a ShopifyGraphQLError to exit 2 with a prefixed message', () => {
    const r = mapErrorForReport(new ShopifyGraphQLError('Field "foo" does not exist.'));
    expect(r.exitCode).toBe(2);
    expect(r.message).toBe('Shopify GraphQL error: Field "foo" does not exist.');
  });

  it('maps a ShopifyValidationError to exit 2 with the multi-line issue/record format', () => {
    const result = z.object({ price: z.string() }).safeParse({ price: 5 });
    if (result.success) throw new Error('expected schema parse to fail');
    const err = new ShopifyValidationError({
      fetcher: 'products',
      pathPrefix: ['products', 0],
      issues: result.error.issues,
      rawValue: { price: 5 },
    });
    const mapped = mapErrorForReport(err);
    expect(mapped.exitCode).toBe(2);
    const lines = mapped.message.split('\n');
    expect(lines[0]).toBe('Schema validation failed while running the products fetcher.');
    expect(lines[1]).toContain('products.0.price');
    expect(lines[1]).toContain('(got: 5)');
    expect(lines[lines.length - 1]).toContain('Record (truncated):');
    expect(lines[lines.length - 1]).toContain('"price":5');
  });

  it('maps a plain Error to exit 2 with an operational-error prefix', () => {
    const r = mapErrorForReport(new Error('disk full'));
    expect(r.exitCode).toBe(2);
    expect(r.message).toBe('Operational error: disk full');
  });

  it('maps ShopifyAccessDeniedError to exit 1 with scope guidance', () => {
    const mapped = mapErrorForReport(
      new ShopifyAccessDeniedError('Access denied for metaobjects field. Required access: `read_metaobjects` access scope.'),
    );
    expect(mapped.exitCode).toBe(1);
    expect(mapped.message).toContain('read_metaobjects');
    expect(mapped.message).toContain('Dev Dashboard');
    expect(mapped.message).toContain('--scope');
  });

  it('maps a ShopifyUserError to operational exit code 2', () => {
    const err = new ShopifyUserError('productUpdate', [{ field: ['title'], message: 'too long' }]);
    const mapped = mapErrorForReport(err);
    expect(mapped.exitCode).toBe(2);
    expect(mapped.message).toContain('Shopify rejected the write');
    expect(mapped.message).toContain('too long');
  });

  it('maps unknown non-Error values to exit 2', () => {
    expect(mapErrorForReport('boom')).toEqual({ exitCode: 2, message: 'Operational error: boom' });
  });
});

describe('writeError', () => {
  it('writes a json envelope and returns the exit code', () => {
    let written = '';
    const code = writeError({ write: (s: string) => (written += s) }, new InvalidOptionError('bad'), true);
    expect(code).toBe(1);
    expect(written).toBe(JSON.stringify({ error: 'bad', exitCode: 1 }) + '\n');
  });

  it('writes a human line and returns the exit code', () => {
    let written = '';
    const code = writeError(
      { write: (s: string) => (written += s) },
      new ShopifyThrottledError('slow down'),
      false,
    );
    expect(code).toBe(2);
    expect(written).toBe('fallback: Shopify throttled the request. slow down\n');
  });
});
