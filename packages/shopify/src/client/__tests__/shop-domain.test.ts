import { describe, expect, it } from 'vitest';

import { ShopifyConfigError, assertApiVersion, assertShopDomain } from '../shop-domain';

describe('assertShopDomain', () => {
  it.each(['example-store.myshopify.com', 'Example-Store.MyShopify.com', 'a1.myshopify.com'])(
    'accepts %s',
    (domain) => {
      expect(() => assertShopDomain(domain)).not.toThrow();
    },
  );

  it.each([
    'evil.example.com',
    'example.myshopify.com.evil.com',
    'https://example.myshopify.com',
    'example.myshopify.com/',
    'example.myshopify.com:443',
    'user@example.myshopify.com',
    'evil.example/x#.myshopify.com',
    '../../example.myshopify.com',
    '-example.myshopify.com',
    'myshopify.com',
    '',
  ])('rejects %j before it can be used as a host or path', (domain) => {
    expect(() => assertShopDomain(domain)).toThrow(ShopifyConfigError);
  });
});

describe('assertApiVersion', () => {
  it.each(['2026-04', '2026-10', 'unstable'])('accepts %s', (version) => {
    expect(() => assertApiVersion(version)).not.toThrow();
  });

  it.each(['latest', '2026-4', '2026-04/../../x', '2026-04?x=1', ''])('rejects %j', (version) => {
    expect(() => assertApiVersion(version)).toThrow(ShopifyConfigError);
  });
});
