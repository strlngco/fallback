import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { Cli } from 'clipanion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Manifest } from '@strlngco/fallback-core';
import type {
  Collection,
  InventoryLevel,
  Metafield,
  MetafieldDefinition,
  Metaobject,
  MetaobjectDefinition,
  Product,
  ProductVariant,
} from '@strlngco/fallback-shopify';

import type { ProductRecord, SnapshotWriter } from '../../snapshot/writer';
import { DiffCommand } from '../diff';
import {
  SnapshotCommand,
  type SnapshotContext,
  type SnapshotDependencies,
} from '../snapshot';

const SHOP = 'example.myshopify.com';
const SNAPSHOT_ID = '2026-05-29T04-24-50Z';

async function* asAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function buildProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'gid://shopify/Product/1',
    handle: 'tee',
    title: 'Tee',
    descriptionHtml: '<p>tee</p>',
    productType: 'Shirts',
    vendor: 'Strlng',
    tags: [],
    status: 'ACTIVE',
    templateSuffix: null,
    options: [],
    seo: { title: null, description: null },
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    publishedAt: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

function buildVariant(overrides: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id: 'gid://shopify/ProductVariant/100',
    product: { id: 'gid://shopify/Product/1' },
    title: 'Default',
    sku: 'TEE-1',
    barcode: null,
    price: { amount: '19.99', currencyCode: 'USD' },
    compareAtPrice: null,
    position: 1,
    inventoryPolicy: 'DENY',
    inventoryQuantity: 5,
    taxable: true,
    taxCode: null,
    selectedOptions: [],
    inventoryItem: {
      id: 'gid://shopify/InventoryItem/1000',
      tracked: true,
      requiresShipping: true,
      measurement: { weight: null },
    },
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

function buildCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: 'gid://shopify/Collection/200',
    handle: 'summer-sale',
    title: 'Summer Sale',
    descriptionHtml: '',
    templateSuffix: null,
    sortOrder: 'MANUAL',
    image: null,
    seo: { title: null, description: null },
    ruleSet: null,
    products: [],
    updatedAt: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

function buildMetafield(overrides: Partial<Metafield> = {}): Metafield {
  return {
    id: 'gid://shopify/Metafield/300',
    ownerId: 'gid://shopify/Product/1',
    ownerType: 'PRODUCT',
    namespace: 'custom',
    key: 'care_guide',
    type: 'multi_line_text_field',
    value: 'Wash cold.',
    description: null,
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

function buildInventoryLevel(overrides: Partial<InventoryLevel> = {}): InventoryLevel {
  return {
    id: 'gid://shopify/InventoryLevel/500?inventory_item_id=1000',
    item: { id: 'gid://shopify/InventoryItem/1000' },
    location: { id: 'gid://shopify/Location/1', name: 'Main Warehouse' },
    quantities: [{ name: 'available', quantity: 12 }],
    updatedAt: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

function buildManifest(overrides: Partial<Manifest['scope']> = {}): Manifest {
  return {
    version: 1,
    shop: SHOP,
    capturedAt: '2026-05-29T04:24:50.000Z',
    apiVersion: '2026-04',
    fallbackVersion: '0.1.0',
    scope: {
      products: true,
      collections: true,
      metafields: true,
      inventoryLevels: true,
      themes: false,
      customers: false,
      orders: false,
      discounts: false,
      ...overrides,
    },
    counts: {
      products: 1,
      variants: 1,
      collections: 1,
      metafields: 1,
      inventoryLevels: 1,
    },
    durationMs: 1234,
    snapshotId: SNAPSHOT_ID,
  };
}

interface SetupOpts {
  baseDir: string;
  shop?: string;
  snapshotId?: string;
  manifest?: Manifest;
  products?: ProductRecord[];
  collections?: Collection[];
  metafields?: Metafield[];
  inventoryLevels?: InventoryLevel[];
}

async function setupSnapshot(opts: SetupOpts): Promise<string> {
  const shop = opts.shop ?? SHOP;
  const snapshotId = opts.snapshotId ?? SNAPSHOT_ID;
  const dir = join(opts.baseDir, shop, snapshotId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'manifest.json'),
    JSON.stringify(opts.manifest ?? buildManifest(), null, 2),
    'utf-8',
  );
  await writeFile(
    join(dir, 'products.ndjson'),
    ndjson(opts.products ?? []),
    'utf-8',
  );
  await writeFile(
    join(dir, 'collections.ndjson'),
    ndjson(opts.collections ?? []),
    'utf-8',
  );
  await writeFile(
    join(dir, 'metafields.ndjson'),
    ndjson(opts.metafields ?? []),
    'utf-8',
  );
  await writeFile(
    join(dir, 'inventory-levels.ndjson'),
    ndjson(opts.inventoryLevels ?? []),
    'utf-8',
  );
  return dir;
}

function ndjson<T>(items: T[]): string {
  if (items.length === 0) return '';
  return items.map((i) => JSON.stringify(i)).join('\n') + '\n';
}

async function drain(iter: AsyncIterable<unknown>): Promise<number> {
  let count = 0;
  for await (const _item of iter) {
    void _item;
    count++;
  }
  return count;
}

function metaobjectFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'gid://shopify/Metaobject/1',
    type: 'care_guide',
    handle: 'wool',
    displayName: 'Wool',
    updatedAt: '2026-06-01T00:00:00Z',
    fields: [{ key: 'title', type: 'single_line_text_field', value: 'Wool' }],
    ...overrides,
  };
}

function metaobjectDefinitionFixture(): Record<string, unknown> {
  return {
    id: 'gid://shopify/MetaobjectDefinition/1',
    type: 'care_guide',
    name: 'Care guide',
    description: null,
    displayNameKey: 'title',
    fieldDefinitions: [],
  };
}

function noopFetchers(): SnapshotDependencies['fetchers'] {
  return {
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
  };
}

interface WriteSnapshotFixtureOpts {
  shop?: string;
  snapshotId?: string;
  manifestScope?: Partial<Manifest['scope']>;
  files?: Record<string, unknown[]>;
}

async function writeSnapshotFixture(opts: WriteSnapshotFixtureOpts): Promise<string> {
  const shop = opts.shop ?? SHOP;
  const snapshotId = opts.snapshotId ?? SNAPSHOT_ID;
  const dir = join(baseDir, shop, snapshotId);
  await mkdir(dir, { recursive: true });
  const manifest = buildManifest(opts.manifestScope ?? {});
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  const scope = manifest.scope;
  const ndjsonFiles = [
    ...(scope.products ? ['products.ndjson'] : []),
    ...(scope.collections ? ['collections.ndjson'] : []),
    ...(scope.metafields ? ['metafields.ndjson'] : []),
    ...(scope.inventoryLevels ? ['inventory-levels.ndjson'] : []),
    ...(scope.metafieldOwnerTypes !== undefined ? ['metafield-definitions.ndjson'] : []),
    ...(scope.metaobjects ? ['metaobjects.ndjson', 'metaobject-definitions.ndjson'] : []),
  ];
  for (const name of ndjsonFiles) {
    const items = opts.files?.[name] ?? [];
    await writeFile(join(dir, name), ndjson(items), 'utf-8');
  }
  return dir;
}

function makeDeps(overrides: Partial<SnapshotDependencies> = {}): SnapshotDependencies {
  return makeFakeDeps({}, overrides);
}

async function runDiffCommand(
  deps: SnapshotDependencies,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const { exit, stdout, stderr } = await runDiff(['diff', ...args, '--base-dir', baseDir], deps);
  return { code: exit, stdout, stderr };
}

function makeFakeWriter(): SnapshotWriter {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    writeProducts: vi.fn(drain),
    writeCollections: vi.fn(drain),
    writeMetafields: vi.fn(drain),
    writeInventoryLevels: vi.fn(drain),
    finish: vi.fn(),
  } as unknown as SnapshotWriter;
}

interface FetcherInputs {
  products?: ProductRecord[];
  collections?: Collection[];
  metafields?: Metafield[];
  inventoryLevels?: InventoryLevel[];
}

function makeFakeDeps(
  current: FetcherInputs = {},
  overrides: Partial<SnapshotDependencies> = {},
): SnapshotDependencies {
  const base: SnapshotDependencies = {
    buildClient: vi.fn(() => ({
      request: vi.fn(),
      getGrantedScopes: vi.fn(async () => [
        'read_products',
        'read_metaobjects',
        'read_metaobject_definitions',
      ]),
    })) as unknown as SnapshotDependencies['buildClient'],
    buildWriter: vi.fn(() => makeFakeWriter()) as unknown as SnapshotDependencies['buildWriter'],
    fetchers: {
      products: vi.fn(() => asAsyncIterable<ProductRecord>(current.products ?? [])),
      collections: vi.fn(() => asAsyncIterable<Collection>(current.collections ?? [])),
      metafields: vi.fn(() => asAsyncIterable<Metafield>(current.metafields ?? [])),
      variantMetafields: vi.fn(() => asAsyncIterable<Metafield>([])),
      collectionMetafields: vi.fn(() => asAsyncIterable<Metafield>([])),
      shopMetafields: vi.fn(() => asAsyncIterable<Metafield>([])),
      metafieldDefinitions: vi.fn(() => asAsyncIterable<MetafieldDefinition>([])),
      metaobjectDefinitions: vi.fn(() => asAsyncIterable<MetaobjectDefinition>([])),
      metaobjects: vi.fn(() => asAsyncIterable<Metaobject>([])),
      inventoryLevels: vi.fn(() => asAsyncIterable<InventoryLevel>(current.inventoryLevels ?? [])),
    },
    resolveAuth: vi.fn().mockResolvedValue({
      shopDomain: SHOP,
      clientId: 'cid_test',
      clientSecret: 'cs_test',
      apiVersion: '2026-04',
    }),
    now: () => new Date('2026-05-29T05:00:00.000Z'),
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

async function runDiff(args: string[], deps: SnapshotDependencies): Promise<CommandRun> {
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
  cli.register(DiffCommand);
  cli.register(SnapshotCommand);
  const exit = await cli.run(args, {
    stdin: Readable.from([]),
    stdout,
    stderr,
    env: { ...process.env, NO_COLOR: '1' },
    colorDepth: 0,
    deps,
  });
  return {
    exit: exit ?? 0,
    stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
    stderr: stripAnsi(Buffer.concat(stderrChunks).toString('utf-8')),
  };
}

let baseDir: string;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'fallback-diff-test-'));
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

describe('DiffCommand', () => {
  it('fetches inventory from every location only when the snapshot did', async () => {
    const level = buildInventoryLevel();
    const options = async (manifest: Manifest): Promise<unknown> => {
      await setupSnapshot({ baseDir, manifest, products: [], collections: [], metafields: [], inventoryLevels: [level] });
      const deps = makeFakeDeps({ products: [], collections: [], metafields: [], inventoryLevels: [level] });
      await runDiff(['diff', SNAPSHOT_ID, '--base-dir', baseDir, '--json'], deps);
      return (deps.fetchers.inventoryLevels as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    };
    // A 1.0.1 snapshot covered active locations only; widening the fetch would
    // report every level at other locations as created.
    expect(await options(buildManifest())).toEqual({ allLocations: false });
    expect(await options(buildManifest({ inventoryAllLocations: true }))).toEqual({ allLocations: true });
  });

  it('names the target store on the first line, but not with --json', async () => {
    const product: ProductRecord = { product: buildProduct(), variants: [buildVariant()] };
    await setupSnapshot({ baseDir, products: [product], collections: [], metafields: [], inventoryLevels: [] });
    const deps = makeFakeDeps({ products: [product], collections: [], metafields: [], inventoryLevels: [] });

    const human = await runDiff(['diff', SNAPSHOT_ID, '--base-dir', baseDir], deps);
    expect(human.stderr.split('\n')[0]).toBe(`Diffing ${SHOP} against snapshot ${SNAPSHOT_ID}`);

    const json = await runDiff(['diff', SNAPSHOT_ID, '--base-dir', baseDir, '--json'], deps);
    expect(json.stderr).not.toContain('Diffing');
  });

  it('reports "No changes" for every resource when current matches the snapshot exactly', async () => {
    const product: ProductRecord = { product: buildProduct(), variants: [buildVariant()] };
    const collection = buildCollection();
    const metafield = buildMetafield();
    const level = buildInventoryLevel();

    await setupSnapshot({
      baseDir,
      products: [product],
      collections: [collection],
      metafields: [metafield],
      inventoryLevels: [level],
    });

    const deps = makeFakeDeps({
      products: [product],
      collections: [collection],
      metafields: [metafield],
      inventoryLevels: [level],
    });
    const { exit, stderr } = await runDiff(
      ['diff', SNAPSHOT_ID, '--base-dir', baseDir],
      deps,
    );
    expect(exit).toBe(0);
    expect(stderr).toContain('Products');
    expect(stderr).toContain('Collections');
    expect(stderr).toContain('Metafields');
    expect(stderr).toContain('InventoryLevels');
    const noChanges = (stderr.match(/No changes/g) ?? []).length;
    expect(noChanges).toBe(4);
  });

  it('reports created/updated/deleted across all categories', async () => {
    const snapProduct: ProductRecord = {
      product: buildProduct({ id: 'gid://shopify/Product/1', title: 'Tee v1' }),
      variants: [buildVariant({ id: 'gid://shopify/ProductVariant/1' })],
    };
    const snapDeletedProduct: ProductRecord = {
      product: buildProduct({ id: 'gid://shopify/Product/9', title: 'Goner' }),
      variants: [buildVariant({ id: 'gid://shopify/ProductVariant/9' })],
    };
    const curUpdatedProduct: ProductRecord = {
      product: buildProduct({ id: 'gid://shopify/Product/1', title: 'Tee v2' }),
      variants: [buildVariant({ id: 'gid://shopify/ProductVariant/1' })],
    };
    const curNewProduct: ProductRecord = {
      product: buildProduct({ id: 'gid://shopify/Product/2', title: 'Mug' }),
      variants: [buildVariant({ id: 'gid://shopify/ProductVariant/2' })],
    };

    await setupSnapshot({
      baseDir,
      products: [snapProduct, snapDeletedProduct],
    });

    const deps = makeFakeDeps({
      products: [curUpdatedProduct, curNewProduct],
    });

    const { exit, stderr } = await runDiff(
      ['diff', SNAPSHOT_ID, '--base-dir', baseDir],
      deps,
    );

    expect(exit).toBe(0);
    expect(stderr).toContain('Created: 1');
    expect(stderr).toContain('+ Mug');
    expect(stderr).toContain('Updated: 1');
    expect(stderr).toContain('~ Tee v2');
    expect(stderr).toContain('title: "Tee v1" → "Tee v2"');
    expect(stderr).toContain('Deleted: 1');
    expect(stderr).toContain('- Goner');
  });

  it('summarizes "N field changes — use --json for details" for >3 field changes', async () => {
    const product: ProductRecord = {
      product: buildProduct({ id: 'gid://shopify/Product/1', title: 'A', vendor: 'V1', productType: 'T1' }),
      variants: [buildVariant()],
    };
    const updated: ProductRecord = {
      product: buildProduct({
        id: 'gid://shopify/Product/1',
        title: 'B',
        vendor: 'V2',
        productType: 'T2',
        descriptionHtml: '<p>new</p>',
        handle: 'changed',
      }),
      variants: [buildVariant()],
    };
    await setupSnapshot({ baseDir, products: [product] });
    const deps = makeFakeDeps({ products: [updated] });
    const { exit, stderr } = await runDiff(
      ['diff', SNAPSHOT_ID, '--base-dir', baseDir],
      deps,
    );
    expect(exit).toBe(0);
    expect(stderr).toMatch(/\d+ field changes — use --json for details/);
  });

  it('skips disabled scopes when --scope products,collections', async () => {
    const product: ProductRecord = { product: buildProduct(), variants: [buildVariant()] };
    await setupSnapshot({
      baseDir,
      products: [product],
      collections: [buildCollection()],
      metafields: [buildMetafield()],
      inventoryLevels: [buildInventoryLevel()],
    });
    const deps = makeFakeDeps({
      products: [product],
      collections: [buildCollection()],
    });
    const { exit, stderr } = await runDiff(
      ['diff', SNAPSHOT_ID, '--base-dir', baseDir, '--scope', 'products,collections'],
      deps,
    );
    expect(exit).toBe(0);
    expect(stderr).toContain('Products');
    expect(stderr).toContain('Collections');
    expect(stderr).not.toContain('Metafields');
    expect(stderr).not.toContain('InventoryLevels');
    expect(deps.fetchers.metafields).not.toHaveBeenCalled();
    expect(deps.fetchers.inventoryLevels).not.toHaveBeenCalled();
  });

  it('rejects a snapshot id that is not in snapshot id format before touching the filesystem', async () => {
    const { exit, stderr } = await runDiff(
      ['diff', '../../elsewhere', '--base-dir', baseDir],
      makeFakeDeps(),
    );
    expect(exit).toBe(1);
    expect(stderr).toContain('is not a snapshot id');
  });

  it('exits 1 when the snapshot id does not exist', async () => {
    const { exit, stderr } = await runDiff(
      ['diff', '2026-01-01T00-00-00Z', '--base-dir', baseDir],
      makeFakeDeps(),
    );
    expect(exit).toBe(1);
    expect(stderr).toContain('Snapshot 2026-01-01T00-00-00Z not found');
  });

  it('exits 1 when --scope requests a resource the snapshot did not capture', async () => {
    await setupSnapshot({
      baseDir,
      manifest: buildManifest({ metafields: false }),
    });
    const { exit, stderr } = await runDiff(
      ['diff', SNAPSHOT_ID, '--base-dir', baseDir, '--scope', 'metafields'],
      makeFakeDeps(),
    );
    expect(exit).toBe(1);
    expect(stderr).toContain('requested resources not captured');
    expect(stderr).toContain('metafields');
  });

  it('falls back to manifest scope when --scope is not provided', async () => {
    await setupSnapshot({
      baseDir,
      manifest: buildManifest({ metafields: false, inventoryLevels: false }),
    });
    const deps = makeFakeDeps();
    const { exit, stderr } = await runDiff(
      ['diff', SNAPSHOT_ID, '--base-dir', baseDir],
      deps,
    );
    expect(exit).toBe(0);
    expect(stderr).toContain('Products');
    expect(stderr).toContain('Collections');
    expect(stderr).not.toContain('Metafields');
    expect(stderr).not.toContain('InventoryLevels');
    expect(deps.fetchers.metafields).not.toHaveBeenCalled();
    expect(deps.fetchers.inventoryLevels).not.toHaveBeenCalled();
  });

  it('feeds product IDs from the products fetcher into the metafields fetcher', async () => {
    const product: ProductRecord = {
      product: buildProduct({ id: 'gid://shopify/Product/42' }),
      variants: [buildVariant()],
    };
    await setupSnapshot({ baseDir, products: [product], metafields: [] });
    const deps = makeFakeDeps({ products: [product], metafields: [] });
    const { exit } = await runDiff(
      ['diff', SNAPSHOT_ID, '--base-dir', baseDir],
      deps,
    );
    expect(exit).toBe(0);
    expect(deps.fetchers.metafields).toHaveBeenCalledTimes(1);
    const passedOwnerIds = (deps.fetchers.metafields as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as string[];
    expect(passedOwnerIds).toEqual(['gid://shopify/Product/42']);
  });

  it('emits compact summary with --summary-only', async () => {
    const product: ProductRecord = { product: buildProduct(), variants: [buildVariant()] };
    await setupSnapshot({
      baseDir,
      products: [product],
      collections: [buildCollection()],
      metafields: [buildMetafield()],
      inventoryLevels: [buildInventoryLevel()],
    });
    const deps = makeFakeDeps({
      products: [product],
      collections: [buildCollection({ title: 'Updated Title' })],
      metafields: [buildMetafield()],
      inventoryLevels: [buildInventoryLevel()],
    });
    const { exit, stdout, stderr } = await runDiff(
      ['diff', SNAPSHOT_ID, '--base-dir', baseDir, '--summary-only'],
      deps,
    );
    expect(exit).toBe(0);
    expect(stdout).toBe('');
    expect(stderr).toContain('Products: +0 / ~0 / -0 (1 in snapshot, 1 in current)');
    expect(stderr).toContain('Collections: +0 / ~1 / -0 (1 in snapshot, 1 in current)');
    expect(stderr).toContain('Metafields: +0 / ~0 / -0');
    expect(stderr).toContain('InventoryLevels: +0 / ~0 / -0');
    expect(stderr).not.toContain('Created:');
  });

  it('emits a valid SnapshotDiff as JSON with --json', async () => {
    const snapProduct: ProductRecord = {
      product: buildProduct({ id: 'gid://shopify/Product/1', title: 'A' }),
      variants: [buildVariant()],
    };
    const curProduct: ProductRecord = {
      product: buildProduct({ id: 'gid://shopify/Product/1', title: 'B' }),
      variants: [buildVariant()],
    };
    await setupSnapshot({ baseDir, products: [snapProduct] });
    const deps = makeFakeDeps({ products: [curProduct] });
    const { exit, stdout, stderr } = await runDiff(
      ['diff', SNAPSHOT_ID, '--base-dir', baseDir, '--json'],
      deps,
    );
    expect(exit).toBe(0);
    expect(stderr).toBe('');
    const parsed = JSON.parse(stdout) as {
      snapshotId: string;
      shop: string;
      computedAt: string;
      resources: Record<string, unknown>;
    };
    expect(parsed.snapshotId).toBe(SNAPSHOT_ID);
    expect(parsed.shop).toBe(SHOP);
    expect(parsed.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const products = parsed.resources['products'] as {
      updated: Array<{ id: string; changes: Array<{ path: string; before: unknown; after: unknown }> }>;
    };
    expect(products.updated).toHaveLength(1);
    expect(products.updated[0]?.changes).toEqual(
      expect.arrayContaining([{ path: 'title', before: 'A', after: 'B' }]),
    );
  });

  it('with --json --with-report, emits JSON to stdout and the human report to stderr from a single fetch', async () => {
    const snapProduct: ProductRecord = {
      product: buildProduct({ id: 'gid://shopify/Product/1', title: 'A' }),
      variants: [buildVariant()],
    };
    const curProduct: ProductRecord = {
      product: buildProduct({ id: 'gid://shopify/Product/1', title: 'B' }),
      variants: [buildVariant()],
    };
    await setupSnapshot({ baseDir, products: [snapProduct] });
    const deps = makeFakeDeps({ products: [curProduct] });
    const { exit, stdout, stderr } = await runDiff(
      ['diff', SNAPSHOT_ID, '--base-dir', baseDir, '--json', '--with-report'],
      deps,
    );
    expect(exit).toBe(0);
    const parsed = JSON.parse(stdout) as { resources: Record<string, unknown> };
    expect(parsed.resources['products']).toBeDefined();
    expect(stderr).toContain('Products');
    expect(stderr).toContain('Updated: 1');
    expect(stderr).toContain('title: "A" → "B"');
    expect(deps.fetchers.products).toHaveBeenCalledTimes(1);
  });

  it('diff --json emits byte-stable stdout', async () => {
    // Same setup as the "emits a valid SnapshotDiff as JSON with --json" test above.
    const snapProduct: ProductRecord = {
      product: buildProduct({ id: 'gid://shopify/Product/1', title: 'A' }),
      variants: [buildVariant()],
    };
    const curProduct: ProductRecord = {
      product: buildProduct({ id: 'gid://shopify/Product/1', title: 'B' }),
      variants: [buildVariant()],
    };
    await setupSnapshot({ baseDir, products: [snapProduct] });
    const deps = makeFakeDeps({ products: [curProduct] });
    const { exit, stdout } = await runDiff(['diff', SNAPSHOT_ID, '--base-dir', baseDir, '--json'], deps);
    expect(exit).toBe(0);
    expect(stdout).toMatchSnapshot();
  });

  it('emits errors as JSON when --json is set', async () => {
    const { exit, stdout, stderr } = await runDiff(
      ['diff', 'missing-snapshot', '--base-dir', baseDir, '--json'],
      makeFakeDeps(),
    );
    expect(exit).toBe(1);
    expect(stdout).toBe('');
    const parsed = JSON.parse(stderr) as { error: string; exitCode: number };
    expect(parsed.exitCode).toBe(1);
    expect(parsed.error).toContain('missing-snapshot');
  });

  it('reports zero changes when variants are reordered with no content changes', async () => {
    const v1 = buildVariant({ id: 'gid://shopify/ProductVariant/1', position: 1 });
    const v2 = buildVariant({ id: 'gid://shopify/ProductVariant/2', position: 2 });
    const v3 = buildVariant({ id: 'gid://shopify/ProductVariant/3', position: 3 });
    const snap: ProductRecord = {
      product: buildProduct({ id: 'gid://shopify/Product/1' }),
      variants: [v1, v2, v3],
    };
    const reordered: ProductRecord = {
      product: buildProduct({ id: 'gid://shopify/Product/1' }),
      variants: [v3, v1, v2],
    };
    await setupSnapshot({ baseDir, products: [snap] });
    const deps = makeFakeDeps({ products: [reordered] });
    const { exit, stderr } = await runDiff(
      ['diff', SNAPSHOT_ID, '--base-dir', baseDir],
      deps,
    );
    expect(exit).toBe(0);
    expect(stderr).toContain('No changes');
    expect(stderr).not.toContain('Updated: 1');
  });

  it('reports exactly one change when variants are reordered and one variant price changes', async () => {
    const v1 = buildVariant({
      id: 'gid://shopify/ProductVariant/1',
      price: { amount: '10.00', currencyCode: 'USD' },
    });
    const v2 = buildVariant({
      id: 'gid://shopify/ProductVariant/2',
      price: { amount: '20.00', currencyCode: 'USD' },
    });
    const v3 = buildVariant({
      id: 'gid://shopify/ProductVariant/3',
      price: { amount: '30.00', currencyCode: 'USD' },
    });
    const snap: ProductRecord = {
      product: buildProduct({ id: 'gid://shopify/Product/1' }),
      variants: [v1, v2, v3],
    };
    const v2Updated = buildVariant({
      id: 'gid://shopify/ProductVariant/2',
      price: { amount: '25.00', currencyCode: 'USD' },
    });
    const reorderedAndEdited: ProductRecord = {
      product: buildProduct({ id: 'gid://shopify/Product/1' }),
      variants: [v3, v1, v2Updated],
    };
    await setupSnapshot({ baseDir, products: [snap] });
    const deps = makeFakeDeps({ products: [reorderedAndEdited] });
    const { exit, stderr } = await runDiff(
      ['diff', SNAPSHOT_ID, '--base-dir', baseDir],
      deps,
    );
    expect(exit).toBe(0);
    expect(stderr).toContain('Updated: 1');
    expect(stderr).toContain(
      'variants[gid://shopify/ProductVariant/2].price.amount: "20.00" → "25.00"',
    );
    // No false positives from reorder
    expect(stderr).not.toContain('variants[gid://shopify/ProductVariant/1]');
    expect(stderr).not.toContain('variants[gid://shopify/ProductVariant/3]');
  });

  it('treats an updatedAt-only change as "No changes" (suppresses timestamp noise)', async () => {
    const product: ProductRecord = {
      product: buildProduct({ updatedAt: '2026-05-28T00:00:00Z' }),
      variants: [buildVariant({ updatedAt: '2026-05-28T00:00:00Z' })],
    };
    const updated: ProductRecord = {
      product: buildProduct({ updatedAt: '2026-05-29T00:00:00Z' }),
      variants: [buildVariant({ updatedAt: '2026-05-29T00:00:00Z' })],
    };
    await setupSnapshot({ baseDir, products: [product] });
    const deps = makeFakeDeps({ products: [updated] });
    const { exit, stderr } = await runDiff(
      ['diff', SNAPSHOT_ID, '--base-dir', baseDir],
      deps,
    );
    expect(exit).toBe(0);
    expect(stderr).toContain('No changes');
    expect(stderr).not.toContain('Updated: 1');
  });

  it('emits exactly one change when a real field changes alongside updatedAt', async () => {
    const product: ProductRecord = {
      product: buildProduct({ title: 'Old', updatedAt: '2026-05-28T00:00:00Z' }),
      variants: [buildVariant({ updatedAt: '2026-05-28T00:00:00Z' })],
    };
    const updated: ProductRecord = {
      product: buildProduct({ title: 'New', updatedAt: '2026-05-29T00:00:00Z' }),
      variants: [buildVariant({ updatedAt: '2026-05-29T00:00:00Z' })],
    };
    await setupSnapshot({ baseDir, products: [product] });
    const deps = makeFakeDeps({ products: [updated] });
    const { exit, stderr } = await runDiff(
      ['diff', SNAPSHOT_ID, '--base-dir', baseDir],
      deps,
    );
    expect(exit).toBe(0);
    expect(stderr).toContain('Updated: 1');
    expect(stderr).toContain('title: "Old" → "New"');
    expect(stderr).not.toContain('updatedAt');
  });

  it('treats a metafield with only updatedAt changed as unchanged', async () => {
    const metafield = buildMetafield({ updatedAt: '2026-05-28T00:00:00Z' });
    const updated = buildMetafield({ updatedAt: '2026-05-29T00:00:00Z' });
    await setupSnapshot({ baseDir, metafields: [metafield] });
    const deps = makeFakeDeps({ metafields: [updated] });
    const { exit, stderr } = await runDiff(
      ['diff', SNAPSHOT_ID, '--base-dir', baseDir],
      deps,
    );
    expect(exit).toBe(0);
    const metafieldsSection = stderr.slice(stderr.indexOf('Metafields'));
    expect(metafieldsSection).toContain('No changes');
  });

  it('produces zero changes when variants are reordered with position numbers updated (real Shopify behavior)', async () => {
    const v1 = buildVariant({ id: 'gid://shopify/ProductVariant/1', position: 1 });
    const v2 = buildVariant({ id: 'gid://shopify/ProductVariant/2', position: 2 });
    const v3 = buildVariant({ id: 'gid://shopify/ProductVariant/3', position: 3 });
    const snap: ProductRecord = {
      product: buildProduct({ id: 'gid://shopify/Product/1' }),
      variants: [v1, v2, v3],
    };
    // After reorder: v3 moves to position 1, v1 to 2, v2 to 3
    const v3Reordered = { ...v3, position: 1 };
    const v1Reordered = { ...v1, position: 2 };
    const v2Reordered = { ...v2, position: 3 };
    const reordered: ProductRecord = {
      product: buildProduct({ id: 'gid://shopify/Product/1' }),
      variants: [v3Reordered, v1Reordered, v2Reordered],
    };
    await setupSnapshot({ baseDir, products: [snap] });
    const deps = makeFakeDeps({ products: [reordered] });
    const { exit, stderr } = await runDiff(
      ['diff', SNAPSHOT_ID, '--base-dir', baseDir],
      deps,
    );
    expect(exit).toBe(0);
    expect(stderr).toContain('No changes');
    expect(stderr).not.toContain('position');
  });

  it('--show-ignored bypasses the noise configs and surfaces timestamps and positions', async () => {
    const product: ProductRecord = {
      product: buildProduct({ updatedAt: '2026-05-28T00:00:00Z' }),
      variants: [buildVariant({ updatedAt: '2026-05-28T00:00:00Z' })],
    };
    const updated: ProductRecord = {
      product: buildProduct({ updatedAt: '2026-05-29T00:00:00Z' }),
      variants: [buildVariant({ updatedAt: '2026-05-29T00:00:00Z' })],
    };
    await setupSnapshot({ baseDir, products: [product] });
    const deps = makeFakeDeps({ products: [updated] });
    const { exit, stderr } = await runDiff(
      ['diff', SNAPSHOT_ID, '--base-dir', baseDir, '--show-ignored'],
      deps,
    );
    expect(exit).toBe(0);
    expect(stderr).toContain('Updated: 1');
    expect(stderr).toContain('updatedAt');
  });

  it('detects variant changes via the flattened products shape', async () => {
    const snap: ProductRecord = {
      product: buildProduct({ id: 'gid://shopify/Product/1' }),
      variants: [buildVariant({ price: { amount: '80.00', currencyCode: 'USD' } })],
    };
    const cur: ProductRecord = {
      product: buildProduct({ id: 'gid://shopify/Product/1' }),
      variants: [buildVariant({ price: { amount: '85.00', currencyCode: 'USD' } })],
    };
    await setupSnapshot({ baseDir, products: [snap] });
    const deps = makeFakeDeps({ products: [cur] });
    const { exit, stderr } = await runDiff(
      ['diff', SNAPSHOT_ID, '--base-dir', baseDir],
      deps,
    );
    expect(exit).toBe(0);
    expect(stderr).toContain(
      'variants[gid://shopify/ProductVariant/100].price.amount: "80.00" → "85.00"',
    );
  });

  it('omits the "ignored changes" line when no changes were suppressed', async () => {
    const snap: ProductRecord = {
      product: buildProduct({ title: 'Old' }),
      variants: [buildVariant()],
    };
    const cur: ProductRecord = {
      product: buildProduct({ title: 'New' }),
      variants: [buildVariant()],
    };
    await setupSnapshot({ baseDir, products: [snap] });
    const deps = makeFakeDeps({ products: [cur] });
    const { exit, stderr } = await runDiff(
      ['diff', SNAPSHOT_ID, '--base-dir', baseDir],
      deps,
    );
    expect(exit).toBe(0);
    expect(stderr).toContain('Updated: 1');
    expect(stderr).toContain('title: "Old" → "New"');
    expect(stderr).not.toMatch(/ignored changes/);
  });

  it('appends "N ignored changes (use --show-ignored to view)" when there is one suppressed change alongside a real change', async () => {
    const snap: ProductRecord = {
      product: buildProduct({ title: 'Old', updatedAt: '2026-05-28T00:00:00Z' }),
      variants: [buildVariant()],
    };
    const cur: ProductRecord = {
      product: buildProduct({ title: 'New', updatedAt: '2026-05-29T00:00:00Z' }),
      variants: [buildVariant()],
    };
    await setupSnapshot({ baseDir, products: [snap] });
    const deps = makeFakeDeps({ products: [cur] });
    const { exit, stderr } = await runDiff(
      ['diff', SNAPSHOT_ID, '--base-dir', baseDir],
      deps,
    );
    expect(exit).toBe(0);
    expect(stderr).toContain('Updated: 1');
    expect(stderr).toContain('title: "Old" → "New"');
    expect(stderr).toContain('1 ignored changes (use --show-ignored to view)');
  });

  it('shows the ignored-changes count on the section header even when there are no Updated records', async () => {
    const v1 = buildVariant({ id: 'gid://shopify/ProductVariant/1', position: 1 });
    const v2 = buildVariant({ id: 'gid://shopify/ProductVariant/2', position: 2 });
    const v3 = buildVariant({ id: 'gid://shopify/ProductVariant/3', position: 3 });
    const snap: ProductRecord = {
      product: buildProduct(),
      variants: [v1, v2, v3],
    };
    const reordered: ProductRecord = {
      product: buildProduct(),
      variants: [
        { ...v3, position: 1 },
        { ...v1, position: 2 },
        { ...v2, position: 3 },
      ],
    };
    await setupSnapshot({ baseDir, products: [snap] });
    const deps = makeFakeDeps({ products: [reordered] });
    const { exit, stderr } = await runDiff(
      ['diff', SNAPSHOT_ID, '--base-dir', baseDir],
      deps,
    );
    expect(exit).toBe(0);
    const productsSection = stderr.slice(stderr.indexOf('Products'), stderr.indexOf('\nCollections'));
    expect(productsSection).toContain('No changes');
    expect(productsSection).not.toContain('Updated: 1');
    expect(productsSection).toContain('3 ignored changes (use --show-ignored to view)');
  });

  it('treats a variant inventoryQuantity change as noise, not product drift', async () => {
    const snap: ProductRecord = {
      product: buildProduct(),
      variants: [buildVariant({ inventoryQuantity: 5 })],
    };
    const sold: ProductRecord = {
      product: buildProduct(),
      variants: [buildVariant({ inventoryQuantity: 3 })],
    };
    await setupSnapshot({ baseDir, products: [snap] });
    const deps = makeFakeDeps({ products: [sold] });
    const { exit, stderr } = await runDiff(
      ['diff', SNAPSHOT_ID, '--base-dir', baseDir],
      deps,
    );
    expect(exit).toBe(0);
    const productsSection = stderr.slice(stderr.indexOf('Products'), stderr.indexOf('\nCollections'));
    expect(productsSection).toContain('No changes');
    expect(productsSection).not.toContain('Updated: 1');
    expect(productsSection).toContain('1 ignored changes (use --show-ignored to view)');
  });

  it('--show-ignored surfaces a variant inventoryQuantity change', async () => {
    const snap: ProductRecord = {
      product: buildProduct(),
      variants: [buildVariant({ inventoryQuantity: 5 })],
    };
    const sold: ProductRecord = {
      product: buildProduct(),
      variants: [buildVariant({ inventoryQuantity: 3 })],
    };
    await setupSnapshot({ baseDir, products: [snap] });
    const deps = makeFakeDeps({ products: [sold] });
    const { exit, stderr } = await runDiff(
      ['diff', SNAPSHOT_ID, '--base-dir', baseDir, '--show-ignored'],
      deps,
    );
    expect(exit).toBe(0);
    expect(stderr).toContain('Updated: 1');
    expect(stderr).toContain('variants[gid://shopify/ProductVariant/100].inventoryQuantity: 5 → 3');
  });

  it('does not emit the ignored line in --show-ignored mode', async () => {
    const snap: ProductRecord = {
      product: buildProduct({ title: 'Old', updatedAt: '2026-05-28T00:00:00Z' }),
      variants: [buildVariant()],
    };
    const cur: ProductRecord = {
      product: buildProduct({ title: 'New', updatedAt: '2026-05-29T00:00:00Z' }),
      variants: [buildVariant()],
    };
    await setupSnapshot({ baseDir, products: [snap] });
    const deps = makeFakeDeps({ products: [cur] });
    const { exit, stderr } = await runDiff(
      ['diff', SNAPSHOT_ID, '--base-dir', baseDir, '--show-ignored'],
      deps,
    );
    expect(exit).toBe(0);
    expect(stderr).toContain('updatedAt');
    expect(stderr).not.toMatch(/ignored changes \(use --show-ignored/);
  });

  it('does not emit the ignored line in --summary-only mode', async () => {
    const snap: ProductRecord = {
      product: buildProduct({ title: 'Old', updatedAt: '2026-05-28T00:00:00Z' }),
      variants: [buildVariant()],
    };
    const cur: ProductRecord = {
      product: buildProduct({ title: 'New', updatedAt: '2026-05-29T00:00:00Z' }),
      variants: [buildVariant()],
    };
    await setupSnapshot({ baseDir, products: [snap] });
    const deps = makeFakeDeps({ products: [cur] });
    const { exit, stderr } = await runDiff(
      ['diff', SNAPSHOT_ID, '--base-dir', baseDir, '--summary-only'],
      deps,
    );
    expect(exit).toBe(0);
    expect(stderr).not.toMatch(/ignored changes/);
  });

  it('rolls up to "N field changes — use --json for details" in default mode when changes exceed the inline cap', async () => {
    // 10 tags + 12 tags produces 13 changes: 1 length, 10 element edits, 2 new tail elements.
    const snap: ProductRecord = {
      product: buildProduct({ tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] }),
      variants: [buildVariant()],
    };
    const cur: ProductRecord = {
      product: buildProduct({
        tags: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
      }),
      variants: [buildVariant()],
    };
    await setupSnapshot({ baseDir, products: [snap] });
    const deps = makeFakeDeps({ products: [cur] });
    const { exit, stderr } = await runDiff(
      ['diff', SNAPSHOT_ID, '--base-dir', baseDir],
      deps,
    );
    expect(exit).toBe(0);
    const rollup = stderr.match(/(\d+) field changes — use --json for details/);
    expect(rollup?.[1]).toBe('13');
    expect(stderr.match(/use --json for details/g) ?? []).toHaveLength(1);
    // Individual change lines should NOT appear when rolled up.
    expect(stderr).not.toContain('tags.0:');
  });

  it('--show-ignored disables the inline cap and lists every change', async () => {
    const snap: ProductRecord = {
      product: buildProduct({ tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] }),
      variants: [buildVariant()],
    };
    const cur: ProductRecord = {
      product: buildProduct({
        tags: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
      }),
      variants: [buildVariant()],
    };
    await setupSnapshot({ baseDir, products: [snap] });
    const deps = makeFakeDeps({ products: [cur] });
    const { exit, stderr } = await runDiff(
      ['diff', SNAPSHOT_ID, '--base-dir', baseDir, '--show-ignored'],
      deps,
    );
    expect(exit).toBe(0);
    expect(stderr).not.toContain('use --json for details');
    // Spot-check that representative paths from across the 13 changes are present.
    expect(stderr).toContain('tags.length:');
    expect(stderr).toContain('tags.0: "a" → "1"');
    expect(stderr).toContain('tags.9: "j" → "10"');
    expect(stderr).toContain('tags.10:');
    expect(stderr).toContain('tags.11:');
  });

  it('--show-ignored mode still renders a single-change record inline (no regression on small N)', async () => {
    const snap: ProductRecord = {
      product: buildProduct({ title: 'Old' }),
      variants: [buildVariant()],
    };
    const cur: ProductRecord = {
      product: buildProduct({ title: 'New' }),
      variants: [buildVariant()],
    };
    await setupSnapshot({ baseDir, products: [snap] });
    const deps = makeFakeDeps({ products: [cur] });
    const { exit, stderr } = await runDiff(
      ['diff', SNAPSHOT_ID, '--base-dir', baseDir, '--show-ignored'],
      deps,
    );
    expect(exit).toBe(0);
    expect(stderr).toContain('Updated: 1');
    expect(stderr).toContain('title: "Old" → "New"');
    expect(stderr).not.toContain('use --json for details');
  });

  it('--show-ignored still truncates per-value previews at 60 characters', async () => {
    const longBody = '<p>' + 'a'.repeat(200) + '</p>';
    const snap: ProductRecord = {
      product: buildProduct({ descriptionHtml: '<p>short</p>' }),
      variants: [buildVariant()],
    };
    const cur: ProductRecord = {
      product: buildProduct({ descriptionHtml: longBody }),
      variants: [buildVariant()],
    };
    await setupSnapshot({ baseDir, products: [snap] });
    const deps = makeFakeDeps({ products: [cur] });
    const { exit, stderr } = await runDiff(
      ['diff', SNAPSHOT_ID, '--base-dir', baseDir, '--show-ignored'],
      deps,
    );
    expect(exit).toBe(0);
    expect(stderr).toContain('descriptionHtml:');
    // Truncated form shows up; full 200-a body must not.
    expect(stderr).toMatch(/"<p>a+\.\.\./);
    expect(stderr).not.toContain('a'.repeat(60));
  });

  it('--json mode emits ignoredCount in the structure but no summary line', async () => {
    const snap: ProductRecord = {
      product: buildProduct({ title: 'Old', updatedAt: '2026-05-28T00:00:00Z' }),
      variants: [buildVariant()],
    };
    const cur: ProductRecord = {
      product: buildProduct({ title: 'New', updatedAt: '2026-05-29T00:00:00Z' }),
      variants: [buildVariant()],
    };
    await setupSnapshot({ baseDir, products: [snap] });
    const deps = makeFakeDeps({ products: [cur] });
    const { exit, stdout, stderr } = await runDiff(
      ['diff', SNAPSHOT_ID, '--base-dir', baseDir, '--json'],
      deps,
    );
    expect(exit).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).not.toMatch(/use --show-ignored to view/);
    const parsed = JSON.parse(stdout) as {
      resources: { products: { ignoredCount: number; updated: Array<{ ignoredCount: number }> } };
    };
    expect(parsed.resources.products.ignoredCount).toBe(1);
    expect(parsed.resources.products.updated[0]?.ignoredCount).toBe(1);
  });

  it('diffs metaobjects and definitions when the manifest captured them', async () => {
    await writeSnapshotFixture({
      manifestScope: {
        products: false, collections: false, metafields: false, inventoryLevels: false,
        metaobjects: true, metafieldOwnerTypes: [],
        themes: false, customers: false, orders: false, discounts: false,
      },
      files: {
        'metaobjects.ndjson': [metaobjectFixture({ handle: 'wool', displayName: 'Wool (old)' })],
        'metaobject-definitions.ndjson': [metaobjectDefinitionFixture()],
      },
    });
    const deps = makeDeps({
      fetchers: {
        ...noopFetchers(),
        metaobjectDefinitions: vi.fn(() => asAsyncIterable<MetaobjectDefinition>([metaobjectDefinitionFixture() as unknown as MetaobjectDefinition])),
        metaobjects: vi.fn(() =>
          asAsyncIterable<Metaobject>([
            metaobjectFixture({ handle: 'wool', displayName: 'Wool (new)' }) as unknown as Metaobject,
          ]),
        ),
      },
    });
    const { code, stdout } = await runDiffCommand(deps, [SNAPSHOT_ID, '--json']);
    expect(code).toBe(0);
    const diff = JSON.parse(stdout) as {
      resources: {
        metaobjects: { updated: Array<{ changes: Array<{ path: string; before: unknown; after: unknown }> }> };
        metaobjectDefinitions: { unchanged: number };
      };
    };
    expect(diff.resources.metaobjects.updated).toHaveLength(1);
    expect(diff.resources.metaobjects.updated[0]?.changes).toEqual([
      { path: 'displayName', before: 'Wool (old)', after: 'Wool (new)' },
    ]);
    expect(diff.resources.metaobjectDefinitions.unchanged).toBe(1);
  });

  it('does not fetch content for a pre-content snapshot (like-for-like)', async () => {
    await writeSnapshotFixture({
      manifestScope: {
        products: false, collections: false, metafields: true, inventoryLevels: false,
        themes: false, customers: false, orders: false, discounts: false,
      },
      files: { 'metafields.ndjson': [] },
    });
    const deps = makeDeps({ fetchers: noopFetchers() });
    const { code } = await runDiffCommand(deps, [SNAPSHOT_ID, '--json']);
    expect(code).toBe(0);
    expect(deps.fetchers.variantMetafields).not.toHaveBeenCalled();
    expect(deps.fetchers.collectionMetafields).not.toHaveBeenCalled();
    expect(deps.fetchers.shopMetafields).not.toHaveBeenCalled();
    expect(deps.fetchers.metaobjects).not.toHaveBeenCalled();
    expect(deps.fetchers.metafieldDefinitions).not.toHaveBeenCalled();
  });

  it('fetches variant and collection owners when the manifest records full coverage', async () => {
    await writeSnapshotFixture({
      manifestScope: {
        products: false, collections: false, metafields: true, inventoryLevels: false,
        metaobjects: false,
        metafieldOwnerTypes: ['PRODUCT', 'PRODUCTVARIANT', 'COLLECTION', 'SHOP'],
        themes: false, customers: false, orders: false, discounts: false,
      },
      files: {
        'metafields.ndjson': [],
        'metafield-definitions.ndjson': [],
      },
    });
    const deps = makeDeps({ fetchers: noopFetchers() });
    const { code } = await runDiffCommand(deps, [SNAPSHOT_ID, '--json']);
    expect(code).toBe(0);
    expect(deps.fetchers.variantMetafields).toHaveBeenCalledTimes(1);
    expect(deps.fetchers.collectionMetafields).toHaveBeenCalledTimes(1);
    expect(deps.fetchers.shopMetafields).toHaveBeenCalledTimes(1);
  });

  it('rejects --scope metaobjects against a snapshot that did not capture them', async () => {
    await writeSnapshotFixture({
      manifestScope: {
        products: true, collections: false, metafields: false, inventoryLevels: false,
        themes: false, customers: false, orders: false, discounts: false,
      },
      files: {},
    });
    const deps = makeDeps({ fetchers: noopFetchers() });
    const { code, stderr } = await runDiffCommand(deps, [SNAPSHOT_ID, '--scope', 'metaobjects']);
    expect(code).toBe(1);
    expect(stderr).toContain('metaobjects');
  });

  it('exits 1 before diffing when the manifest captured metaobjects but the app lacks the read scopes', async () => {
    await writeSnapshotFixture({
      manifestScope: {
        products: false, collections: false, metafields: false, inventoryLevels: false,
        metaobjects: true, metafieldOwnerTypes: [],
        themes: false, customers: false, orders: false, discounts: false,
      },
      files: {
        'metaobjects.ndjson': [metaobjectFixture()],
        'metaobject-definitions.ndjson': [metaobjectDefinitionFixture()],
      },
    });
    const deps = makeDeps({
      buildClient: vi.fn(() => ({
        request: vi.fn(),
        getGrantedScopes: vi.fn(async () => ['read_products']),
      })) as unknown as SnapshotDependencies['buildClient'],
      fetchers: noopFetchers(),
    });
    const { code, stderr } = await runDiffCommand(deps, [SNAPSHOT_ID]);
    expect(code).toBe(1);
    expect(stderr).toContain('read_metaobjects');
    expect(stderr).toContain('Diffing metaobjects requires');
    expect(stderr).toContain('read_metaobject_definitions');
    expect(deps.fetchers.metaobjects).not.toHaveBeenCalled();
  });

  it('does not check granted scopes for a pre-content snapshot that never captured metaobjects', async () => {
    const getGrantedScopes = vi.fn(async () => ['read_products']);
    await writeSnapshotFixture({
      manifestScope: {
        products: false, collections: false, metafields: true, inventoryLevels: false,
        themes: false, customers: false, orders: false, discounts: false,
      },
      files: { 'metafields.ndjson': [] },
    });
    const deps = makeDeps({
      buildClient: vi.fn(() => ({
        request: vi.fn(),
        getGrantedScopes,
      })) as unknown as SnapshotDependencies['buildClient'],
      fetchers: noopFetchers(),
    });
    const { code } = await runDiffCommand(deps, [SNAPSHOT_ID]);
    expect(code).toBe(0);
    expect(getGrantedScopes).not.toHaveBeenCalled();
  });
});
