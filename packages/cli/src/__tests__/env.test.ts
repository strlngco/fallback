import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShopifyConfigError } from '@strlngco/fallback-shopify';
import { parseEnvFile, resolveAuth, resolveShopDomain } from '../env';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fb-env-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('resolveShopDomain', () => {
  it('returns undefined when nothing configures a shop', async () => {
    const shop = await resolveShopDomain({ cwd: dir, homeDir: dir, processEnv: {} });
    expect(shop).toBeUndefined();
  });

  it('prefers processEnv over .env files', async () => {
    await writeFile(join(dir, '.env'), 'SHOPIFY_SHOP_DOMAIN=file.myshopify.com\n', 'utf-8');
    const shop = await resolveShopDomain({
      cwd: dir,
      homeDir: dir,
      processEnv: { SHOPIFY_SHOP_DOMAIN: 'env.myshopify.com' },
    });
    expect(shop).toBe('env.myshopify.com');
  });

  it('reads SHOPIFY_SHOP_DOMAIN from the cwd .env when not in processEnv', async () => {
    await writeFile(join(dir, '.env'), 'SHOPIFY_SHOP_DOMAIN=file.myshopify.com\n', 'utf-8');
    const shop = await resolveShopDomain({ cwd: dir, homeDir: '/no/such/home', processEnv: {} });
    expect(shop).toBe('file.myshopify.com');
  });

  it('resolves without requiring client id/secret, unlike resolveAuth', async () => {
    await expect(
      resolveShopDomain({ cwd: dir, homeDir: dir, processEnv: { SHOPIFY_SHOP_DOMAIN: 'x.myshopify.com' } }),
    ).resolves.toBe('x.myshopify.com');
  });

  it('treats a whitespace-only SHOPIFY_SHOP_DOMAIN in processEnv as absent', async () => {
    const shop = await resolveShopDomain({ cwd: dir, homeDir: dir, processEnv: { SHOPIFY_SHOP_DOMAIN: '   ' } });
    expect(shop).toBeUndefined();
  });
});

describe('resolveAuth validation', () => {
  const credentials = { SHOPIFY_CLIENT_ID: 'id', SHOPIFY_CLIENT_SECRET: 'secret' };

  it('rejects a shop domain that is not a myshopify.com domain', async () => {
    await expect(
      resolveAuth({
        cwd: dir,
        homeDir: dir,
        processEnv: { ...credentials, SHOPIFY_SHOP_DOMAIN: 'evil.example.com' },
      }),
    ).rejects.toBeInstanceOf(ShopifyConfigError);
  });

  it('rejects a --shop override that would escape the snapshot directory', async () => {
    await expect(
      resolveAuth({
        shopOverride: '../../x.myshopify.com',
        cwd: dir,
        homeDir: dir,
        processEnv: { ...credentials, SHOPIFY_SHOP_DOMAIN: 'ok.myshopify.com' },
      }),
    ).rejects.toBeInstanceOf(ShopifyConfigError);
  });

  it('rejects a malformed SHOPIFY_API_VERSION', async () => {
    await expect(
      resolveAuth({
        cwd: dir,
        homeDir: dir,
        processEnv: {
          ...credentials,
          SHOPIFY_SHOP_DOMAIN: 'ok.myshopify.com',
          SHOPIFY_API_VERSION: '2026-04/../x',
        },
      }),
    ).rejects.toBeInstanceOf(ShopifyConfigError);
  });
});

describe('parseEnvFile', () => {
  it('reads plain, double-quoted, and single-quoted values', () => {
    expect(parseEnvFile('A=one\nB="two"\nC=\'three\'\n')).toEqual({ A: 'one', B: 'two', C: 'three' });
  });

  it('accepts lines written as shell exports', () => {
    expect(parseEnvFile('export SHOPIFY_CLIENT_ID=abc\nexport  B="x y"\n')).toEqual({
      SHOPIFY_CLIENT_ID: 'abc',
      B: 'x y',
    });
  });

  it('drops an inline comment after an unquoted value', () => {
    expect(parseEnvFile('SHOPIFY_SHOP_DOMAIN=example-store.myshopify.com # staging\n')).toEqual({
      SHOPIFY_SHOP_DOMAIN: 'example-store.myshopify.com',
    });
  });

  it('keeps a # that is part of an unquoted value', () => {
    expect(parseEnvFile('A=abc#def\n')).toEqual({ A: 'abc#def' });
  });

  it('keeps a # inside quotes and drops a comment after the closing quote', () => {
    expect(parseEnvFile('A="abc # def" # note\nB=\'x#y\'#note\n')).toEqual({ A: 'abc # def', B: 'x#y' });
  });

  it('handles CRLF line endings and skips comments and blank lines', () => {
    expect(parseEnvFile('# header\r\n\r\nA=one\r\nB="two"\r\n')).toEqual({ A: 'one', B: 'two' });
  });

  it('treats a key named export as a key', () => {
    expect(parseEnvFile('export=1\n')).toEqual({ export: '1' });
  });
});
