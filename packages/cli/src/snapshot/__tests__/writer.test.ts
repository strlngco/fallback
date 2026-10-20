import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ManifestSchema } from '@strlngco/fallback-core';
import type {
  Collection,
  InventoryLevel,
  Metafield,
  Product,
  ProductVariant,
} from '@strlngco/fallback-shopify';

import { SnapshotWriter, type ProductRecord, type ScopeFlags } from '../writer';

const SHOP = 'example.myshopify.com';
const CLI_PACKAGE_JSON_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../package.json',
);

const fullScope: ScopeFlags = {
  products: true,
  collections: true,
  metafields: true,
  inventoryLevels: true,
  metaobjects: false,
};

const product: Product = {
  id: 'gid://shopify/Product/1',
  handle: 'tee',
  title: 'Tee',
  descriptionHtml: '<p>tee</p>',
  productType: 'Shirts',
  vendor: 'Strlng',
  tags: ['summer'],
  status: 'ACTIVE',
  templateSuffix: null,
  options: [
    { id: 'gid://shopify/ProductOption/10', name: 'Size', position: 1, values: ['S'] },
  ],
  seo: { title: null, description: null },
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
  publishedAt: '2026-05-01T00:00:00Z',
};

const variant: ProductVariant = {
  id: 'gid://shopify/ProductVariant/100',
  product: { id: 'gid://shopify/Product/1' },
  title: 'S',
  sku: 'TEE-S',
  barcode: null,
  price: { amount: '19.99', currencyCode: 'USD' },
  compareAtPrice: null,
  position: 1,
  inventoryPolicy: 'DENY',
  inventoryQuantity: 5,
  taxable: true,
  taxCode: null,
  selectedOptions: [{ name: 'Size', value: 'S' }],
  inventoryItem: {
    id: 'gid://shopify/InventoryItem/1000',
    tracked: true,
    requiresShipping: true,
    measurement: { weight: { value: 200, unit: 'GRAMS' } },
  },
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
};

const collection: Collection = {
  id: 'gid://shopify/Collection/200',
  handle: 'summer-sale',
  title: 'Summer Sale',
  descriptionHtml: '<p>Summer.</p>',
  templateSuffix: null,
  sortOrder: 'MANUAL',
  image: null,
  seo: { title: null, description: null },
  ruleSet: null,
  products: [{ id: 'gid://shopify/Product/1', handle: 'tee' }],
  updatedAt: '2026-05-01T00:00:00Z',
};

const metafield: Metafield = {
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
};

const inventoryLevel: InventoryLevel = {
  id: 'gid://shopify/InventoryLevel/500',
  item: { id: 'gid://shopify/InventoryItem/1000' },
  location: { id: 'gid://shopify/Location/1', name: 'Main Warehouse' },
  quantities: [
    { name: 'available', quantity: 12 },
    { name: 'on_hand', quantity: 12 },
  ],
  updatedAt: '2026-05-01T00:00:00Z',
};

async function* asAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

let baseDir: string;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'fallback-writer-test-'));
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

describe('SnapshotWriter', () => {
  it('creates a snapshot directory at <baseDir>/<shop>/<snapshotId> and yields a well-formed snapshotId', async () => {
    const writer = new SnapshotWriter(SHOP, baseDir);
    await writer.start();
    await writer.writeProducts(asAsyncIterable([]));
    await writer.writeCollections(asAsyncIterable([]));
    await writer.writeMetafields(asAsyncIterable([]));
    await writer.writeInventoryLevels(asAsyncIterable([]));
    const result = await writer.finish(fullScope);

    expect(result.snapshotId).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/);
    const expectedDir = join(baseDir, SHOP, result.snapshotId);
    expect(result.snapshotDir).toBe(expectedDir);
    const dirStat = await stat(expectedDir);
    expect(dirStat.isDirectory()).toBe(true);
  });

  it('writes products as NDJSON with one record per line and a trailing newline', async () => {
    const writer = new SnapshotWriter(SHOP, baseDir);
    await writer.start();
    const records: ProductRecord[] = [
      { product, variants: [variant] },
      {
        product: { ...product, id: 'gid://shopify/Product/2', handle: 'mug', title: 'Mug' },
        variants: [],
      },
    ];
    const productsCount = await writer.writeProducts(asAsyncIterable(records));
    await writer.writeCollections(asAsyncIterable([]));
    await writer.writeMetafields(asAsyncIterable([]));
    await writer.writeInventoryLevels(asAsyncIterable([]));
    const result = await writer.finish(fullScope);

    expect(productsCount).toBe(2);
    const raw = await readFile(join(result.snapshotDir, 'products.ndjson'), 'utf-8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw.includes(',\n')).toBe(false);
    const lines = raw.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    const parsed = lines.map((line) => JSON.parse(line) as ProductRecord);
    expect(parsed[0]?.product.id).toBe('gid://shopify/Product/1');
    expect(parsed[0]?.variants).toHaveLength(1);
    expect(parsed[1]?.product.handle).toBe('mug');
  });

  it('writes collections, metafields, and inventory levels each as their own NDJSON file', async () => {
    const writer = new SnapshotWriter(SHOP, baseDir);
    await writer.start();
    await writer.writeProducts(asAsyncIterable([]));
    const collectionsCount = await writer.writeCollections(asAsyncIterable([collection]));
    const metafieldsCount = await writer.writeMetafields(asAsyncIterable([metafield, metafield]));
    const levelsCount = await writer.writeInventoryLevels(asAsyncIterable([inventoryLevel]));
    const result = await writer.finish(fullScope);

    expect(collectionsCount).toBe(1);
    expect(metafieldsCount).toBe(2);
    expect(levelsCount).toBe(1);

    const collectionsRaw = await readFile(join(result.snapshotDir, 'collections.ndjson'), 'utf-8');
    const metafieldsRaw = await readFile(join(result.snapshotDir, 'metafields.ndjson'), 'utf-8');
    const levelsRaw = await readFile(join(result.snapshotDir, 'inventory-levels.ndjson'), 'utf-8');

    expect(collectionsRaw.trimEnd().split('\n')).toHaveLength(1);
    expect(metafieldsRaw.trimEnd().split('\n')).toHaveLength(2);
    expect(levelsRaw.trimEnd().split('\n')).toHaveLength(1);
  });

  it('records inventoryAllLocations only when inventory levels were captured', async () => {
    const writer = new SnapshotWriter(SHOP, baseDir);
    await writer.start();
    await writer.writeProducts(asAsyncIterable([{ product, variants: [variant] }]));
    const result = await writer.finish({
      products: true,
      collections: false,
      metafields: false,
      inventoryLevels: false,
      metaobjects: false,
    });
    const manifest = ManifestSchema.parse(JSON.parse(await readFile(result.manifestPath, 'utf-8')));
    expect(manifest.scope).not.toHaveProperty('inventoryAllLocations');
  });

  it('writes a manifest that validates against ManifestSchema with accurate counts and scope', async () => {
    const writer = new SnapshotWriter(SHOP, baseDir);
    await writer.start();
    await writer.writeProducts(asAsyncIterable([{ product, variants: [variant, variant] }]));
    await writer.writeCollections(asAsyncIterable([collection]));
    await writer.writeMetafields(asAsyncIterable([metafield]));
    await writer.writeInventoryLevels(asAsyncIterable([inventoryLevel]));
    const result = await writer.finish({
      products: true,
      collections: true,
      metafields: false,
      inventoryLevels: true,
      metaobjects: false,
    });

    const manifestRaw = await readFile(result.manifestPath, 'utf-8');
    const manifest = ManifestSchema.parse(JSON.parse(manifestRaw));

    expect(manifest.version).toBe(1);
    expect(manifest.shop).toBe(SHOP);
    expect(manifest.snapshotId).toBe(result.snapshotId);
    expect(manifest.scope).toEqual({
      products: true,
      collections: true,
      metafields: false,
      inventoryLevels: true,
      metaobjects: false,
      metafieldOwnerTypes: [],
      inventoryAllLocations: true,
      themes: false,
      customers: false,
      orders: false,
      discounts: false,
    });
    expect(manifest.counts).toEqual({
      products: 1,
      variants: 2,
      collections: 1,
      metafields: 1,
      inventoryLevels: 1,
      metaobjects: 0,
      metaobjectDefinitions: 0,
      metafieldDefinitions: 0,
    });
    expect(manifest.durationMs).toBeGreaterThanOrEqual(0);
    expect(manifest.fallbackVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(manifest.apiVersion.length).toBeGreaterThan(0);
  });

  it('returns the snapshot directory matching <baseDir>/<shop>/<snapshotId>', async () => {
    const writer = new SnapshotWriter(SHOP, baseDir);
    await writer.start();
    await writer.writeProducts(asAsyncIterable([]));
    await writer.writeCollections(asAsyncIterable([]));
    await writer.writeMetafields(asAsyncIterable([]));
    await writer.writeInventoryLevels(asAsyncIterable([]));
    const result = await writer.finish(fullScope);

    expect(result.snapshotDir).toBe(join(baseDir, SHOP, result.snapshotId));
    expect(result.manifestPath).toBe(join(result.snapshotDir, 'manifest.json'));
  });

  it("writes the fallbackVersion read from cli/package.json into the manifest", async () => {
    const cliPackage = JSON.parse(
      await readFile(CLI_PACKAGE_JSON_PATH, 'utf-8'),
    ) as { name: string; version: string };
    expect(cliPackage.name).toBe('@strlngco/fallback');

    const writer = new SnapshotWriter(SHOP, baseDir);
    await writer.start();
    await writer.writeProducts(asAsyncIterable([]));
    await writer.writeCollections(asAsyncIterable([]));
    await writer.writeMetafields(asAsyncIterable([]));
    await writer.writeInventoryLevels(asAsyncIterable([]));
    const result = await writer.finish(fullScope);

    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf-8')) as {
      fallbackVersion: string;
    };
    expect(manifest.fallbackVersion).toBe(cliPackage.version);
  });

  it('throws if a write method is called before start', async () => {
    const writer = new SnapshotWriter(SHOP, baseDir);
    await expect(writer.writeProducts(asAsyncIterable([]))).rejects.toThrow(/start/);
    await expect(writer.finish(fullScope)).rejects.toThrow(/start/);
  });

  it('throws if start is called twice without an intervening finish', async () => {
    const writer = new SnapshotWriter(SHOP, baseDir);
    await writer.start();
    await expect(writer.start()).rejects.toThrow(/twice/);
  });

  it('writes content files and records content scope in the manifest', async () => {
    const writer = new SnapshotWriter(SHOP, baseDir);
    await writer.start();
    await writer.writeMetaobjectDefinitions(
      asAsyncIterable([
        {
          id: 'gid://shopify/MetaobjectDefinition/1',
          type: 'care_guide',
          name: 'Care guide',
          description: null,
          displayNameKey: null,
          fieldDefinitions: [],
        },
      ]),
    );
    await writer.writeMetaobjects(
      asAsyncIterable([
        {
          id: 'gid://shopify/Metaobject/1',
          type: 'care_guide',
          handle: 'wool',
          displayName: 'Wool',
          updatedAt: '2026-06-01T00:00:00Z',
          fields: [],
        },
      ]),
    );
    await writer.writeMetafieldDefinitions(
      asAsyncIterable([
        {
          id: 'gid://shopify/MetafieldDefinition/1',
          ownerType: 'PRODUCT',
          namespace: 'custom',
          key: 'material',
          name: 'Material',
          description: null,
          type: 'single_line_text_field',
          validations: [],
        },
      ]),
    );
    const result = await writer.finish({
      products: false,
      collections: false,
      metafields: true,
      inventoryLevels: false,
      metaobjects: true,
    });

    expect(result.counts.metaobjects).toBe(1);
    expect(result.counts.metaobjectDefinitions).toBe(1);
    expect(result.counts.metafieldDefinitions).toBe(1);

    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf-8')) as {
      scope: Record<string, unknown>;
    };
    expect(manifest.scope['metaobjects']).toBe(true);
    expect(manifest.scope['metafieldOwnerTypes']).toEqual([
      'PRODUCT',
      'PRODUCTVARIANT',
      'COLLECTION',
      'SHOP',
    ]);

    const entries = await readFile(join(result.snapshotDir, 'metaobjects.ndjson'), 'utf-8');
    expect(entries.trim().split('\n')).toHaveLength(1);
  });

  it('abort() removes the partial snapshot directory; a second abort() is a no-op; start() works again afterward', async () => {
    const writer = new SnapshotWriter(SHOP, baseDir);
    await writer.start();
    await writer.writeProducts(asAsyncIterable([{ product, variants: [variant] }]));

    const shopDir = join(baseDir, SHOP);
    const [snapshotId] = await readdir(shopDir);
    const snapshotDir = join(shopDir, snapshotId!);
    await expect(stat(snapshotDir)).resolves.toBeTruthy();

    await writer.abort();
    await expect(stat(snapshotDir)).rejects.toThrow();

    await expect(writer.abort()).resolves.toBeUndefined();

    await writer.start();
    await writer.writeProducts(asAsyncIterable([]));
    await writer.writeCollections(asAsyncIterable([]));
    await writer.writeMetafields(asAsyncIterable([]));
    await writer.writeInventoryLevels(asAsyncIterable([]));
    const result = await writer.finish(fullScope);
    expect(result.snapshotId).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/);
    await expect(stat(result.snapshotDir)).resolves.toBeTruthy();
  });

  it('records empty owner coverage when metafields are out of scope', async () => {
    const writer = new SnapshotWriter(SHOP, baseDir);
    await writer.start();
    const result = await writer.finish({
      products: false,
      collections: false,
      metafields: false,
      inventoryLevels: false,
      metaobjects: false,
    });
    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf-8')) as {
      scope: Record<string, unknown>;
    };
    expect(manifest.scope['metafieldOwnerTypes']).toEqual([]);
    expect(manifest.scope['metaobjects']).toBe(false);
  });
});

describe('SnapshotWriter failure handling', () => {
  const fixedNow = () => new Date('2026-10-12T09:00:00.000Z');

  async function finishEmpty(writer: SnapshotWriter, apiVersion?: string) {
    await writer.writeProducts(asAsyncIterable([]));
    await writer.writeCollections(asAsyncIterable([]));
    await writer.writeMetafields(asAsyncIterable([]));
    await writer.writeInventoryLevels(asAsyncIterable([]));
    return writer.finish(fullScope, apiVersion !== undefined ? { apiVersion } : undefined);
  }

  it('refuses to share a directory with a capture that started in the same second', async () => {
    const first = new SnapshotWriter(SHOP, baseDir, fixedNow);
    const second = new SnapshotWriter(SHOP, baseDir, fixedNow);
    await first.start();
    await first.writeProducts(asAsyncIterable([{ product, variants: [variant] }]));

    await expect(second.start()).rejects.toThrow(/already exists/);
    await second.abort();

    await first.writeCollections(asAsyncIterable([]));
    await first.writeMetafields(asAsyncIterable([]));
    await first.writeInventoryLevels(asAsyncIterable([]));
    const result = await first.finish(fullScope);
    const products = await readFile(join(result.snapshotDir, 'products.ndjson'), 'utf-8');
    expect(products.trimEnd().split('\n')).toHaveLength(1);
  });

  it('surfaces a stream error raised after a write succeeded instead of crashing the process', async () => {
    const writer = new SnapshotWriter(SHOP, baseDir);
    await writer.start();
    await writer.writeProducts(asAsyncIterable([{ product, variants: [variant] }]));

    const streams = (writer as unknown as { open: { streams: Record<string, { destroy(e: Error): void }> } })
      .open.streams;
    streams.collections!.destroy(Object.assign(new Error('no space left on device'), { code: 'ENOSPC' }));
    await new Promise((resolve) => setImmediate(resolve));

    await expect(writer.writeCollections(asAsyncIterable([collection]))).rejects.toThrow(/no space left/);
    await writer.abort();
    await expect(readdir(join(baseDir, SHOP))).resolves.toEqual([]);
  });

  it('fails finish when a stream errored with nothing left to write', async () => {
    const writer = new SnapshotWriter(SHOP, baseDir);
    await writer.start();
    const streams = (writer as unknown as { open: { streams: Record<string, { destroy(e: Error): void }> } })
      .open.streams;
    streams.inventoryLevels!.destroy(new Error('EIO: i/o error'));
    await new Promise((resolve) => setImmediate(resolve));

    await expect(finishEmpty(writer)).rejects.toThrow(/i\/o error/);
  });

  it('records the API version the capture actually used', async () => {
    const writer = new SnapshotWriter(SHOP, baseDir);
    await writer.start();
    const result = await finishEmpty(writer, '2026-10');
    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf-8')) as { apiVersion: string };
    expect(manifest.apiVersion).toBe('2026-10');
  });

  it('leaves no temporary manifest file behind', async () => {
    const writer = new SnapshotWriter(SHOP, baseDir);
    await writer.start();
    const result = await finishEmpty(writer);
    const entries = await readdir(result.snapshotDir);
    expect(entries.filter((name) => name.includes('tmp'))).toEqual([]);
  });
});
