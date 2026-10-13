import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { Cli } from 'clipanion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  Collection,
  InventoryLevel,
  Metafield,
  MetafieldDefinition,
  Metaobject,
  MetaobjectDefinition,
} from '@strlngco/fallback-shopify';

import { resolveAuth } from '../../env';
import type {
  ProductRecord,
  SnapshotResult,
  SnapshotWriter,
} from '../../snapshot/writer';
import {
  SnapshotCommand,
  type SnapshotContext,
  type SnapshotDependencies,
} from '../snapshot';

async function* asAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

async function drain(iter: AsyncIterable<unknown>): Promise<number> {
  let count = 0;
  for await (const _item of iter) {
    void _item;
    count++;
  }
  return count;
}

function makeFakeWriter(): SnapshotWriter {
  const result: SnapshotResult = {
    snapshotId: '2026-05-06T14-30-22Z',
    snapshotDir: '/tmp/ignored',
    manifestPath: '/tmp/ignored/manifest.json',
    counts: { products: 0, variants: 0, collections: 0, metafields: 0, inventoryLevels: 0 },
    durationMs: 0,
  };
  return {
    start: vi.fn().mockResolvedValue(undefined),
    writeProducts: vi.fn(drain),
    writeCollections: vi.fn(drain),
    writeMetafields: vi.fn(drain),
    writeInventoryLevels: vi.fn(drain),
    writeMetaobjects: vi.fn(drain),
    writeMetaobjectDefinitions: vi.fn(drain),
    writeMetafieldDefinitions: vi.fn(drain),
    finish: vi.fn().mockResolvedValue(result),
  } as unknown as SnapshotWriter;
}

function makeRealEnvDeps(overrides: {
  cwd: string;
  homeDir: string;
  env: Record<string, string | undefined>;
}): { deps: SnapshotDependencies; buildClient: ReturnType<typeof vi.fn> } {
  const writer = makeFakeWriter();
  const buildClient = vi.fn(() => ({
    request: vi.fn(),
    getGrantedScopes: vi.fn(async () => ['read_metaobjects', 'read_metaobject_definitions']),
  }));
  const deps: SnapshotDependencies = {
    buildClient: buildClient as unknown as SnapshotDependencies['buildClient'],
    buildWriter: vi.fn(() => writer) as unknown as SnapshotDependencies['buildWriter'],
    fetchers: {
      products: vi.fn(() => asAsyncIterable<ProductRecord>([])),
      collections: vi.fn(() => asAsyncIterable<Collection>([])),
      metafields: vi.fn(() => asAsyncIterable<Metafield>([])),
      variantMetafields: vi.fn(() => asAsyncIterable<Metafield>([])),
      collectionMetafields: vi.fn(() => asAsyncIterable<Metafield>([])),
      shopMetafields: vi.fn(() => asAsyncIterable<Metafield>([])),
      metafieldDefinitions: vi.fn(() => asAsyncIterable<MetafieldDefinition>([])),
      metaobjectDefinitions: vi.fn(() => asAsyncIterable<MetaobjectDefinition>([])),
      metaobjects: vi.fn(() => asAsyncIterable<Metaobject>([])),
      inventoryLevels: vi.fn(() => asAsyncIterable<InventoryLevel>([])),
    },
    resolveAuth,
    now: () => new Date('2026-05-06T14:30:22Z'),
    cwd: () => overrides.cwd,
    homeDir: () => overrides.homeDir,
    env: () => overrides.env,
  };
  return { deps, buildClient };
}

interface CommandRun {
  exit: number;
  stdout: string;
  stderr: string;
}

async function runCommand(args: string[], deps: SnapshotDependencies): Promise<CommandRun> {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const stdout = new Writable({
    write(chunk: Buffer | string, _enc, cb) {
      stdoutChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      cb();
    },
  });
  const stderr = new Writable({
    write(chunk: Buffer | string, _enc, cb) {
      stderrChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      cb();
    },
  });

  const cli = new Cli<SnapshotContext>({ binaryName: 'fallback' });
  cli.register(SnapshotCommand);

  const exit = await cli.run(args, {
    stdin: Readable.from([]),
    stdout,
    stderr,
    env: { ...process.env },
    colorDepth: 0,
    deps,
  });

  return {
    exit: exit ?? 0,
    stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
    stderr: Buffer.concat(stderrChunks).toString('utf-8'),
  };
}

let tempCwd: string;
let tempHome: string;

beforeEach(async () => {
  tempCwd = await mkdtemp(join(tmpdir(), 'fallback-env-cwd-'));
  tempHome = await mkdtemp(join(tmpdir(), 'fallback-env-home-'));
});

afterEach(async () => {
  await rm(tempCwd, { recursive: true, force: true });
  await rm(tempHome, { recursive: true, force: true });
});

describe('SnapshotCommand env loading', () => {
  it('exits 1 and names only SHOPIFY_SHOP_DOMAIN as missing when client id and secret are set', async () => {
    const { deps } = makeRealEnvDeps({
      cwd: tempCwd,
      homeDir: tempHome,
      env: { SHOPIFY_CLIENT_ID: 'cid', SHOPIFY_CLIENT_SECRET: 'cs' },
    });
    const { exit, stderr } = await runCommand(['snapshot'], deps);
    expect(exit).toBe(1);
    // The "Missing required environment variable: <name>" segment names only the missing var.
    // SHOPIFY_CLIENT_ID/SECRET also appear in the educational tail describing where they come from.
    expect(stderr).toMatch(/Missing required environment variable: SHOPIFY_SHOP_DOMAIN\./);
  });

  it('exits 1 and names all three variables when none are set', async () => {
    const { deps } = makeRealEnvDeps({ cwd: tempCwd, homeDir: tempHome, env: {} });
    const { exit, stderr } = await runCommand(['snapshot'], deps);
    expect(exit).toBe(1);
    expect(stderr).toContain('SHOPIFY_SHOP_DOMAIN');
    expect(stderr).toContain('SHOPIFY_CLIENT_ID');
    expect(stderr).toContain('SHOPIFY_CLIENT_SECRET');
    expect(stderr).toContain('Dev Dashboard');
  });

  it('--shop overrides SHOPIFY_SHOP_DOMAIN from the environment', async () => {
    const { deps, buildClient } = makeRealEnvDeps({
      cwd: tempCwd,
      homeDir: tempHome,
      env: {
        SHOPIFY_SHOP_DOMAIN: 'env-shop.myshopify.com',
        SHOPIFY_CLIENT_ID: 'cid',
        SHOPIFY_CLIENT_SECRET: 'cs',
      },
    });
    const { exit } = await runCommand(
      ['snapshot', '--shop', 'flag-shop.myshopify.com'],
      deps,
    );
    expect(exit).toBe(0);
    expect(buildClient).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: expect.objectContaining({ shopDomain: 'flag-shop.myshopify.com' }),
      }),
    );
  });

  it('reads SHOPIFY_SHOP_DOMAIN, SHOPIFY_CLIENT_ID, and SHOPIFY_CLIENT_SECRET from ~/.fallback/.env', async () => {
    await mkdir(join(tempHome, '.fallback'), { recursive: true });
    await writeFile(
      join(tempHome, '.fallback', '.env'),
      [
        'SHOPIFY_SHOP_DOMAIN=home-shop.myshopify.com',
        'SHOPIFY_CLIENT_ID=cid_from_home',
        'SHOPIFY_CLIENT_SECRET=cs_from_home',
        '',
      ].join('\n'),
      'utf-8',
    );

    const { deps, buildClient } = makeRealEnvDeps({
      cwd: tempCwd,
      homeDir: tempHome,
      env: {},
    });
    const { exit } = await runCommand(['snapshot'], deps);
    expect(exit).toBe(0);
    expect(buildClient).toHaveBeenCalledWith({
      credentials: {
        shopDomain: 'home-shop.myshopify.com',
        clientId: 'cid_from_home',
        clientSecret: 'cs_from_home',
      },
    });
  });

  it('prefers <cwd>/.env over ~/.fallback/.env when both define the same key', async () => {
    await mkdir(join(tempHome, '.fallback'), { recursive: true });
    await writeFile(
      join(tempHome, '.fallback', '.env'),
      [
        'SHOPIFY_SHOP_DOMAIN=home-shop.myshopify.com',
        'SHOPIFY_CLIENT_ID=cid_home',
        'SHOPIFY_CLIENT_SECRET=cs_home',
        '',
      ].join('\n'),
    );
    await writeFile(
      join(tempCwd, '.env'),
      'SHOPIFY_SHOP_DOMAIN=cwd-shop.myshopify.com\n',
    );

    const { deps, buildClient } = makeRealEnvDeps({
      cwd: tempCwd,
      homeDir: tempHome,
      env: {},
    });
    const { exit } = await runCommand(['snapshot'], deps);
    expect(exit).toBe(0);
    expect(buildClient).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: expect.objectContaining({ shopDomain: 'cwd-shop.myshopify.com' }),
      }),
    );
  });

  it('process env wins over both .env files', async () => {
    await mkdir(join(tempHome, '.fallback'), { recursive: true });
    await writeFile(
      join(tempHome, '.fallback', '.env'),
      'SHOPIFY_SHOP_DOMAIN=home-shop.myshopify.com\n',
    );
    await writeFile(
      join(tempCwd, '.env'),
      [
        'SHOPIFY_SHOP_DOMAIN=cwd-shop.myshopify.com',
        'SHOPIFY_CLIENT_ID=cid_cwd',
        'SHOPIFY_CLIENT_SECRET=cs_cwd',
        '',
      ].join('\n'),
    );

    const { deps, buildClient } = makeRealEnvDeps({
      cwd: tempCwd,
      homeDir: tempHome,
      env: { SHOPIFY_SHOP_DOMAIN: 'env-shop.myshopify.com' },
    });
    const { exit } = await runCommand(['snapshot'], deps);
    expect(exit).toBe(0);
    expect(buildClient).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: expect.objectContaining({ shopDomain: 'env-shop.myshopify.com' }),
      }),
    );
  });
});
