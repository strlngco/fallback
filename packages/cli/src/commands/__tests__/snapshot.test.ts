import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { Cli } from 'clipanion';
import { describe, expect, it, vi } from 'vitest';

import { z } from 'zod';

import {
  ShopifyAccessDeniedError,
  ShopifyAuthError,
  ShopifyGraphQLError,
  ShopifyThrottledError,
  ShopifyValidationError,
  type Collection,
  type InventoryLevel,
  type Metafield,
  type MetafieldDefinition,
  type Metaobject,
  type MetaobjectDefinition,
} from '@strlngco/fallback-shopify';

import { MissingEnvError } from '../../env';
import {
  SnapshotWriter as RealSnapshotWriter,
  type ProductRecord,
  type SnapshotResult,
  type SnapshotWriter,
} from '../../snapshot/writer';
import {
  parseScope,
  SnapshotCommand,
  type SnapshotContext,
  type SnapshotDependencies,
} from '../snapshot';

async function* asAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

async function collectAsync(iter: Iterable<string> | AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const t of iter as AsyncIterable<string>) out.push(t);
  return out;
}

async function drain(iter: AsyncIterable<unknown>): Promise<number> {
  let count = 0;
  for await (const _item of iter) {
    void _item;
    count++;
  }
  return count;
}

function noopContentFetchers(): Pick<
  SnapshotDependencies['fetchers'],
  | 'variantMetafields'
  | 'collectionMetafields'
  | 'shopMetafields'
  | 'metafieldDefinitions'
  | 'metaobjectDefinitions'
  | 'metaobjects'
> {
  return {
    variantMetafields: vi.fn(() => asAsyncIterable<Metafield>([])),
    collectionMetafields: vi.fn(() => asAsyncIterable<Metafield>([])),
    shopMetafields: vi.fn(() => asAsyncIterable<Metafield>([])),
    metafieldDefinitions: vi.fn(() => asAsyncIterable<MetafieldDefinition>([])),
    metaobjectDefinitions: vi.fn(() => asAsyncIterable<MetaobjectDefinition>([])),
    metaobjects: vi.fn(() => asAsyncIterable<Metaobject>([])),
  };
}

function makeFakeWriter(): SnapshotWriter {
  const result: SnapshotResult = {
    snapshotId: '2026-05-06T14-30-22Z',
    snapshotDir: '/tmp/snap/example.myshopify.com/2026-05-06T14-30-22Z',
    manifestPath: '/tmp/snap/example.myshopify.com/2026-05-06T14-30-22Z/manifest.json',
    counts: { products: 2, variants: 5, collections: 3, metafields: 7, inventoryLevels: 11 },
    durationMs: 1234,
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

function makeFakeDeps(overrides: Partial<SnapshotDependencies> = {}): SnapshotDependencies {
  const writer = makeFakeWriter();
  const base: SnapshotDependencies = {
    buildClient: vi.fn(() => ({
      request: vi.fn(),
      getGrantedScopes: vi.fn(async () => [
        'read_products',
        'read_metaobjects',
        'read_metaobject_definitions',
      ]),
    })) as unknown as SnapshotDependencies['buildClient'],
    buildWriter: vi.fn(() => writer) as unknown as SnapshotDependencies['buildWriter'],
    fetchers: {
      products: vi.fn(() => asAsyncIterable<ProductRecord>([])),
      collections: vi.fn(() => asAsyncIterable<Collection>([])),
      metafields: vi.fn(() => asAsyncIterable<Metafield>([])),
      inventoryLevels: vi.fn(() => asAsyncIterable<InventoryLevel>([])),
      ...noopContentFetchers(),
    },
    resolveAuth: vi.fn().mockResolvedValue({
      shopDomain: 'example.myshopify.com',
      clientId: 'cid_test',
      clientSecret: 'cs_test',
      apiVersion: '2026-04',
    }),
    now: () => new Date('2026-05-06T14:30:22.000Z'),
    cwd: () => '/tmp/cwd',
    homeDir: () => '/tmp/home',
    env: () => ({}),
  };
  return { ...base, ...overrides };
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

describe('SnapshotCommand', () => {
  it('runs every fetcher and writer when scope is the default (all resources)', async () => {
    const deps = makeFakeDeps();
    const { exit } = await runCommand(['snapshot'], deps);
    expect(exit).toBe(0);

    const writer = (deps.buildWriter as ReturnType<typeof vi.fn>).mock.results[0]?.value as SnapshotWriter;
    expect(writer.start).toHaveBeenCalledTimes(1);
    expect(writer.writeProducts).toHaveBeenCalledTimes(1);
    expect(writer.writeCollections).toHaveBeenCalledTimes(1);
    expect(writer.writeMetafields).toHaveBeenCalledTimes(1);
    expect(writer.writeInventoryLevels).toHaveBeenCalledTimes(1);
    expect(writer.writeMetaobjects).toHaveBeenCalledTimes(1);
    expect(writer.writeMetaobjectDefinitions).toHaveBeenCalledTimes(1);
    expect(writer.writeMetafieldDefinitions).toHaveBeenCalledTimes(1);
    expect(writer.finish).toHaveBeenCalledWith({
      products: true,
      collections: true,
      metafields: true,
      inventoryLevels: true,
      metaobjects: true,
    }, { apiVersion: '2026-04' });

    expect(deps.fetchers.products).toHaveBeenCalledTimes(1);
    expect(deps.fetchers.collections).toHaveBeenCalledTimes(1);
    expect(deps.fetchers.metafields).toHaveBeenCalledTimes(1);
    expect(deps.fetchers.inventoryLevels).toHaveBeenCalledTimes(1);
    expect(deps.fetchers.inventoryLevels).toHaveBeenCalledWith(expect.anything(), { allLocations: true });
    expect(deps.fetchers.variantMetafields).toHaveBeenCalledTimes(1);
    expect(deps.fetchers.collectionMetafields).toHaveBeenCalledTimes(1);
    expect(deps.fetchers.shopMetafields).toHaveBeenCalledTimes(1);
    expect(deps.fetchers.metafieldDefinitions).toHaveBeenCalledTimes(1);
    expect(deps.fetchers.metaobjectDefinitions).toHaveBeenCalledTimes(1);
    expect(deps.fetchers.metaobjects).toHaveBeenCalledTimes(1);
  });

  it('skips disabled scopes (--scope products,collections runs only those two)', async () => {
    const deps = makeFakeDeps();
    const { exit } = await runCommand(['snapshot', '--scope', 'products,collections'], deps);
    expect(exit).toBe(0);

    const writer = (deps.buildWriter as ReturnType<typeof vi.fn>).mock.results[0]?.value as SnapshotWriter;
    expect(writer.writeProducts).toHaveBeenCalledTimes(1);
    expect(writer.writeCollections).toHaveBeenCalledTimes(1);
    expect(writer.writeMetafields).not.toHaveBeenCalled();
    expect(writer.writeInventoryLevels).not.toHaveBeenCalled();

    expect(deps.fetchers.metafields).not.toHaveBeenCalled();
    expect(deps.fetchers.inventoryLevels).not.toHaveBeenCalled();

    expect(writer.finish).toHaveBeenCalledWith({
      products: true,
      collections: true,
      metafields: false,
      inventoryLevels: false,
      metaobjects: false,
    }, { apiVersion: '2026-04' });
  });

  it('feeds product IDs into the metafields fetcher when both scopes are enabled', async () => {
    const productRecords: ProductRecord[] = [
      {
        product: { id: 'gid://shopify/Product/1' } as ProductRecord['product'],
        variants: [],
      },
      {
        product: { id: 'gid://shopify/Product/2' } as ProductRecord['product'],
        variants: [],
      },
    ];
    const deps = makeFakeDeps({
      fetchers: {
        products: vi.fn(() => asAsyncIterable<ProductRecord>(productRecords)),
        collections: vi.fn(() => asAsyncIterable<Collection>([])),
        metafields: vi.fn(() => asAsyncIterable<Metafield>([])),
        inventoryLevels: vi.fn(() => asAsyncIterable<InventoryLevel>([])),
        ...noopContentFetchers(),
      },
    });

    const { exit } = await runCommand(['snapshot'], deps);
    expect(exit).toBe(0);

    expect(deps.fetchers.metafields).toHaveBeenCalledTimes(1);
    const passedOwnerIds = (deps.fetchers.metafields as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string[];
    expect(passedOwnerIds).toEqual(['gid://shopify/Product/1', 'gid://shopify/Product/2']);
  });

  it('emits a human-readable summary to stderr by default', async () => {
    const { exit, stdout, stderr } = await runCommand(['snapshot'], makeFakeDeps());
    expect(exit).toBe(0);
    expect(stdout).toBe('');
    expect(stderr).toContain('Capturing snapshot of example.myshopify.com');
    expect(stderr).toContain(
      'Captured 2 products (5 variants), 3 collections, 7 metafields, 11 inventory levels.',
    );
    expect(stderr).toContain('Snapshot ID: 2026-05-06T14-30-22Z');
    expect(stderr).toContain('Duration: 1.2s');
  });

  it('emits JSON to stdout when --json is set and suppresses the start banner', async () => {
    const { exit, stdout, stderr } = await runCommand(['snapshot', '--json'], makeFakeDeps());
    expect(exit).toBe(0);
    expect(stderr).toBe('');
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed['snapshotId']).toBe('2026-05-06T14-30-22Z');
    expect(parsed['shop']).toBe('example.myshopify.com');
    expect(parsed['scope']).toEqual({
      products: true,
      collections: true,
      metafields: true,
      inventoryLevels: true,
      metaobjects: true,
    });
    expect(parsed['counts']).toEqual({
      products: 2,
      variants: 5,
      collections: 3,
      metafields: 7,
      inventoryLevels: 11,
    });
  });

  it('suppresses non-error output to stderr when --quiet is set', async () => {
    const { exit, stdout, stderr } = await runCommand(['snapshot', '--quiet'], makeFakeDeps());
    expect(exit).toBe(0);
    expect(stdout).toBe('');
    expect(stderr).toBe('');
  });

  it('exits 1 when ShopifyAuthError is thrown by a fetcher', async () => {
    const deps = makeFakeDeps({
      fetchers: {
        products: vi.fn(() => {
          throw new ShopifyAuthError('Token rejected.');
        }) as unknown as SnapshotDependencies['fetchers']['products'],
        collections: vi.fn(() => asAsyncIterable<Collection>([])),
        metafields: vi.fn(() => asAsyncIterable<Metafield>([])),
        inventoryLevels: vi.fn(() => asAsyncIterable<InventoryLevel>([])),
        ...noopContentFetchers(),
      },
    });
    const { exit, stderr } = await runCommand(['snapshot'], deps);
    expect(exit).toBe(1);
    expect(stderr).toContain('rejected the access token');
  });

  it('passes the API version the capture used to the manifest writer', async () => {
    const writer = makeFakeWriter();
    const deps = makeFakeDeps({
      buildWriter: vi.fn(() => writer) as unknown as SnapshotDependencies['buildWriter'],
      resolveAuth: vi.fn().mockResolvedValue({
        shopDomain: 'example.myshopify.com',
        clientId: 'cid_test',
        clientSecret: 'cs_test',
        apiVersion: '2026-10',
      }),
    });
    const { exit } = await runCommand(['snapshot'], deps);
    expect(exit).toBe(0);
    expect(writer.finish).toHaveBeenCalledWith(expect.anything(), { apiVersion: '2026-10' });
  });

  it('removes the partial snapshot directory when interrupted mid-capture, and releases the handler', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'fallback-snapshot-cmd-'));
    try {
      let interrupt: (() => Promise<void>) | undefined;
      const release = vi.fn();
      const deps = makeFakeDeps({
        buildWriter: ((shopDomain: string, base?: string) =>
          new RealSnapshotWriter(shopDomain, base)) as unknown as SnapshotDependencies['buildWriter'],
        onInterrupt: vi.fn((handler: () => Promise<void>) => {
          interrupt = handler;
          return release;
        }),
        fetchers: {
          products: vi.fn(async function* () {
            yield {
              product: { id: 'gid://shopify/Product/1' } as ProductRecord['product'],
              variants: [],
            };
            await interrupt!();
          }) as unknown as SnapshotDependencies['fetchers']['products'],
          collections: vi.fn(() => asAsyncIterable<Collection>([])),
          metafields: vi.fn(() => asAsyncIterable<Metafield>([])),
          inventoryLevels: vi.fn(() => asAsyncIterable<InventoryLevel>([])),
          ...noopContentFetchers(),
        },
      });

      const { stderr } = await runCommand(['snapshot', '--base-dir', baseDir], deps);
      expect(stderr).toContain('Interrupted');

      const entries = await readdir(join(baseDir, 'example.myshopify.com')).catch(() => []);
      expect(entries).toHaveLength(0);
      expect(release).toHaveBeenCalled();
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it('removes the partial snapshot directory when a fetcher throws mid-capture', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'fallback-snapshot-cmd-'));
    try {
      const deps = makeFakeDeps({
        buildWriter: ((shopDomain: string, base?: string) =>
          new RealSnapshotWriter(shopDomain, base)) as unknown as SnapshotDependencies['buildWriter'],
        fetchers: {
          products: vi.fn(async function* () {
            yield {
              product: { id: 'gid://shopify/Product/1' } as ProductRecord['product'],
              variants: [],
            };
            throw new Error('boom mid-capture');
          }) as unknown as SnapshotDependencies['fetchers']['products'],
          collections: vi.fn(() => asAsyncIterable<Collection>([])),
          metafields: vi.fn(() => asAsyncIterable<Metafield>([])),
          inventoryLevels: vi.fn(() => asAsyncIterable<InventoryLevel>([])),
          ...noopContentFetchers(),
        },
      });

      const { exit } = await runCommand(['snapshot', '--base-dir', baseDir], deps);
      expect(exit).not.toBe(0);

      const shopDir = join(baseDir, 'example.myshopify.com');
      const entries = await readdir(shopDir).catch(() => []);
      expect(entries).toHaveLength(0);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it('maps ShopifyAccessDeniedError from a fetcher to exit 1 with guidance', async () => {
    const deps = makeFakeDeps({
      fetchers: {
        products: vi.fn(async function* () {
          throw new ShopifyAccessDeniedError(
            'Access denied for metaobjects field. Required access: `read_metaobjects` access scope.',
          );
        }) as unknown as SnapshotDependencies['fetchers']['products'],
        collections: vi.fn(() => asAsyncIterable<Collection>([])),
        metafields: vi.fn(() => asAsyncIterable<Metafield>([])),
        inventoryLevels: vi.fn(() => asAsyncIterable<InventoryLevel>([])),
        ...noopContentFetchers(),
      },
    });
    const { exit, stderr } = await runCommand(['snapshot'], deps);
    expect(exit).toBe(1);
    expect(stderr).toContain('read_metaobjects');
    expect(stderr).toContain('Dev Dashboard');
  });

  it('exits 2 when ShopifyThrottledError is raised', async () => {
    const deps = makeFakeDeps({
      fetchers: {
        products: vi.fn(() => {
          throw new ShopifyThrottledError('Backoff exhausted.');
        }) as unknown as SnapshotDependencies['fetchers']['products'],
        collections: vi.fn(() => asAsyncIterable<Collection>([])),
        metafields: vi.fn(() => asAsyncIterable<Metafield>([])),
        inventoryLevels: vi.fn(() => asAsyncIterable<InventoryLevel>([])),
        ...noopContentFetchers(),
      },
    });
    const { exit, stderr } = await runCommand(['snapshot'], deps);
    expect(exit).toBe(2);
    expect(stderr).toContain('throttled');
  });

  it('exits 2 when ShopifyGraphQLError is raised', async () => {
    const deps = makeFakeDeps({
      fetchers: {
        products: vi.fn(() => {
          throw new ShopifyGraphQLError('Field "foo" does not exist.');
        }) as unknown as SnapshotDependencies['fetchers']['products'],
        collections: vi.fn(() => asAsyncIterable<Collection>([])),
        metafields: vi.fn(() => asAsyncIterable<Metafield>([])),
        inventoryLevels: vi.fn(() => asAsyncIterable<InventoryLevel>([])),
        ...noopContentFetchers(),
      },
    });
    const { exit, stderr } = await runCommand(['snapshot'], deps);
    expect(exit).toBe(2);
    expect(stderr).toContain('GraphQL');
  });

  it('exits 1 when resolveAuth raises MissingEnvError', async () => {
    const deps = makeFakeDeps({
      resolveAuth: vi
        .fn()
        .mockRejectedValue(
          new MissingEnvError('Missing required environment variable: SHOPIFY_CLIENT_SECRET.', [
            'SHOPIFY_CLIENT_SECRET',
          ]),
        ),
    });
    const { exit, stderr } = await runCommand(['snapshot'], deps);
    expect(exit).toBe(1);
    expect(stderr).toContain('SHOPIFY_CLIENT_SECRET');
  });

  it('exits 1 on an unknown --scope token', async () => {
    const { exit, stderr } = await runCommand(
      ['snapshot', '--scope', 'products,nonsense'],
      makeFakeDeps(),
    );
    expect(exit).toBe(1);
    expect(stderr).toContain('Unknown --scope value');
  });

  it('exits 2 with a generic operational message on an unhandled error', async () => {
    const deps = makeFakeDeps({
      fetchers: {
        products: vi.fn(() => {
          throw new Error('disk on fire');
        }) as unknown as SnapshotDependencies['fetchers']['products'],
        collections: vi.fn(() => asAsyncIterable<Collection>([])),
        metafields: vi.fn(() => asAsyncIterable<Metafield>([])),
        inventoryLevels: vi.fn(() => asAsyncIterable<InventoryLevel>([])),
        ...noopContentFetchers(),
      },
    });
    const { exit, stderr } = await runCommand(['snapshot'], deps);
    expect(exit).toBe(2);
    expect(stderr).toContain('Operational error');
    expect(stderr).toContain('disk on fire');
  });

  it('formats ShopifyValidationError with fetcher, prefixed path, and bad value', async () => {
    const probe = z
      .object({
        id: z
          .string()
          .regex(/^gid:\/\/shopify\/InventoryLevel\/[0-9]+$/, 'Expected a Shopify global ID'),
      })
      .safeParse({ id: 'gid://shopify/InventoryLevel/123?inventory_item_id=456' });
    if (probe.success) throw new Error('test setup: expected the probe schema to fail');

    const validationError = new ShopifyValidationError({
      fetcher: 'inventory-levels',
      pathPrefix: ['inventoryLevels', 5],
      issues: probe.error.issues,
      rawValue: { id: 'gid://shopify/InventoryLevel/123?inventory_item_id=456' },
    });

    const deps = makeFakeDeps({
      fetchers: {
        products: vi.fn(() => asAsyncIterable<ProductRecord>([])),
        collections: vi.fn(() => asAsyncIterable<Collection>([])),
        metafields: vi.fn(() => asAsyncIterable<Metafield>([])),
        inventoryLevels: vi.fn(() => {
          throw validationError;
        }) as unknown as SnapshotDependencies['fetchers']['inventoryLevels'],
        ...noopContentFetchers(),
      },
    });
    const { exit, stderr } = await runCommand(['snapshot'], deps);
    expect(exit).toBe(2);
    expect(stderr).toContain('inventory-levels fetcher');
    expect(stderr).toContain('inventoryLevels.5.id');
    expect(stderr).toContain('Expected a Shopify global ID');
    expect(stderr).toContain('?inventory_item_id=456');
  });

  it('snapshot --json emits byte-stable stdout', async () => {
    const { exit, stdout } = await runCommand(['snapshot', '--json'], makeFakeDeps());
    expect(exit).toBe(0);
    // Lock the exact serialized bytes. If this fails because fixture counts changed,
    // update the expected string deliberately — do not loosen to JSON.parse.
    expect(stdout).toMatchSnapshot();
  });

  it('emits errors as JSON when --json is set', async () => {
    const deps = makeFakeDeps({
      resolveAuth: vi
        .fn()
        .mockRejectedValue(new MissingEnvError('Missing SHOPIFY_CLIENT_SECRET.', ['SHOPIFY_CLIENT_SECRET'])),
    });
    const { exit, stdout, stderr } = await runCommand(['snapshot', '--json'], deps);
    expect(exit).toBe(1);
    expect(stdout).toBe('');
    const parsed = JSON.parse(stderr) as { error: string; exitCode: number };
    expect(parsed.exitCode).toBe(1);
    expect(parsed.error).toContain('SHOPIFY_CLIENT_SECRET');
  });

  it('captures metaobjects via definition types and metafields for all covered owners', async () => {
    const productRecord: ProductRecord = {
      product: { id: 'gid://shopify/Product/1' } as ProductRecord['product'],
      variants: [{ id: 'gid://shopify/ProductVariant/11' } as ProductRecord['variants'][number]],
    };
    const collection = { id: 'gid://shopify/Collection/21' } as Collection;
    const deps = makeFakeDeps({
      fetchers: {
        products: vi.fn(() => asAsyncIterable<ProductRecord>([productRecord])),
        collections: vi.fn(() => asAsyncIterable<Collection>([collection])),
        metafields: vi.fn(() => asAsyncIterable<Metafield>([])),
        variantMetafields: vi.fn(() => asAsyncIterable<Metafield>([])),
        collectionMetafields: vi.fn(() => asAsyncIterable<Metafield>([])),
        shopMetafields: vi.fn(() => asAsyncIterable<Metafield>([])),
        metafieldDefinitions: vi.fn(() => asAsyncIterable<MetafieldDefinition>([])),
        metaobjectDefinitions: vi.fn(() =>
          asAsyncIterable<MetaobjectDefinition>([
            {
              id: 'gid://shopify/MetaobjectDefinition/1',
              type: 'care_guide',
              name: 'Care guide',
              description: null,
              displayNameKey: null,
              fieldDefinitions: [],
            },
          ]),
        ),
        metaobjects: vi.fn(() => asAsyncIterable<Metaobject>([])),
        inventoryLevels: vi.fn(() => asAsyncIterable<InventoryLevel>([])),
      },
    });
    const { exit } = await runCommand(['snapshot'], deps);
    expect(exit).toBe(0);

    expect(deps.fetchers.variantMetafields).toHaveBeenCalledTimes(1);
    const variantIds = (deps.fetchers.variantMetafields as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as string[];
    expect(variantIds).toEqual(['gid://shopify/ProductVariant/11']);

    const collectionIds = (deps.fetchers.collectionMetafields as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as string[];
    expect(collectionIds).toEqual(['gid://shopify/Collection/21']);

    expect(deps.fetchers.shopMetafields).toHaveBeenCalledTimes(1);
    expect(deps.fetchers.metafieldDefinitions).toHaveBeenCalledTimes(1);

    const types = (deps.fetchers.metaobjects as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(await collectAsync(types as AsyncIterable<string>)).toEqual(['care_guide']);
  });

  it('skips all content fetchers when --scope excludes metafields and metaobjects', async () => {
    const deps = makeFakeDeps();
    const { exit } = await runCommand(['snapshot', '--scope', 'products'], deps);
    expect(exit).toBe(0);
    expect(deps.fetchers.variantMetafields).not.toHaveBeenCalled();
    expect(deps.fetchers.collectionMetafields).not.toHaveBeenCalled();
    expect(deps.fetchers.shopMetafields).not.toHaveBeenCalled();
    expect(deps.fetchers.metafieldDefinitions).not.toHaveBeenCalled();
    expect(deps.fetchers.metaobjectDefinitions).not.toHaveBeenCalled();
    expect(deps.fetchers.metaobjects).not.toHaveBeenCalled();
  });

  it('rejects an unknown scope and accepts metaobjects', async () => {
    expect(() => parseScope('metaobjects')).not.toThrow();
    expect(parseScope('metaobjects').metaobjects).toBe(true);
    expect(parseScope('products').metaobjects).toBe(false);
    expect(parseScope(undefined).metaobjects).toBe(true);
  });

  it('exits 1 before any fetch when the default scope includes metaobjects but the app lacks the read scopes', async () => {
    const deps = makeFakeDeps({
      buildClient: vi.fn(() => ({
        request: vi.fn(),
        getGrantedScopes: vi.fn(async () => ['read_products']),
      })) as unknown as SnapshotDependencies['buildClient'],
    });
    const { exit, stderr } = await runCommand(['snapshot'], deps);
    expect(exit).toBe(1);
    expect(stderr).toContain('read_metaobjects');
    expect(stderr).toContain('read_metaobject_definitions');
    expect(stderr).toContain('--scope');
    expect(deps.fetchers.products).not.toHaveBeenCalled();
  });

  it('succeeds without checking granted scopes when --scope excludes metaobjects', async () => {
    const getGrantedScopes = vi.fn(async () => ['read_products']);
    const deps = makeFakeDeps({
      buildClient: vi.fn(() => ({
        request: vi.fn(),
        getGrantedScopes,
      })) as unknown as SnapshotDependencies['buildClient'],
    });
    const { exit } = await runCommand(['snapshot', '--scope', 'products'], deps);
    expect(exit).toBe(0);
    expect(getGrantedScopes).not.toHaveBeenCalled();
  });

  it('proceeds past the preflight when both metaobject read scopes are granted', async () => {
    const deps = makeFakeDeps();
    const { exit } = await runCommand(['snapshot'], deps);
    expect(exit).toBe(0);
    expect(deps.fetchers.metaobjects).toHaveBeenCalledTimes(1);
  });
});
