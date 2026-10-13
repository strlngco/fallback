import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  ManifestSchema,
  type Manifest,
  type ManifestCounts,
} from '@strlngco/fallback-core';
import {
  CONTENT_METAFIELD_OWNER_TYPES,
  SHOPIFY_API_VERSION,
  type Collection,
  type InventoryLevel,
  type Metafield,
  type MetafieldDefinition,
  type Metaobject,
  type MetaobjectDefinition,
  type Product,
  type ProductVariant,
} from '@strlngco/fallback-shopify';

import { FALLBACK_VERSION } from '../version';

const MANIFEST_FILENAME = 'manifest.json';
const PRODUCTS_FILENAME = 'products.ndjson';
const COLLECTIONS_FILENAME = 'collections.ndjson';
const METAFIELDS_FILENAME = 'metafields.ndjson';
const INVENTORY_LEVELS_FILENAME = 'inventory-levels.ndjson';
const METAOBJECTS_FILENAME = 'metaobjects.ndjson';
const METAOBJECT_DEFINITIONS_FILENAME = 'metaobject-definitions.ndjson';
const METAFIELD_DEFINITIONS_FILENAME = 'metafield-definitions.ndjson';

export interface ScopeFlags {
  products: boolean;
  collections: boolean;
  metafields: boolean;
  inventoryLevels: boolean;
  metaobjects: boolean;
}

export interface ProductRecord {
  product: Product;
  variants: ProductVariant[];
}

export interface SnapshotResult {
  snapshotId: string;
  manifestPath: string;
  snapshotDir: string;
  counts: ManifestCounts;
  durationMs: number;
}

interface OpenSnapshot {
  snapshotId: string;
  snapshotDir: string;
  startTime: number;
  streams: {
    products: WriteStream;
    collections: WriteStream;
    metafields: WriteStream;
    inventoryLevels: WriteStream;
    metaobjects: WriteStream;
    metaobjectDefinitions: WriteStream;
    metafieldDefinitions: WriteStream;
  };
}

export interface FinishOptions {
  apiVersion?: string;
}

export class SnapshotWriter {
  private open: OpenSnapshot | null = null;
  private counts: ManifestCounts = freshCounts();

  constructor(
    private readonly shopDomain: string,
    private readonly baseDir: string = defaultBaseDir(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async start(): Promise<void> {
    if (this.open) {
      throw new Error('SnapshotWriter.start() was called twice without an intervening finish().');
    }
    const now = this.now();
    const snapshotId = formatSnapshotId(now);
    const shopDir = join(this.baseDir, this.shopDomain);
    const snapshotDir = join(shopDir, snapshotId);
    await mkdir(shopDir, { recursive: true });
    // Non-recursive so a second capture in the same second fails here instead of
    // truncating the first one's files, and so abort() only ever removes a
    // directory this writer created.
    try {
      await mkdir(snapshotDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(
          `Snapshot ${snapshotId} already exists for ${this.shopDomain}; another capture started ` +
            'in the same second. Wait a moment and run it again.',
        );
      }
      throw err;
    }
    this.counts = freshCounts();
    this.open = {
      snapshotId,
      snapshotDir,
      startTime: now.getTime(),
      streams: {
        products: openStream(join(snapshotDir, PRODUCTS_FILENAME)),
        collections: openStream(join(snapshotDir, COLLECTIONS_FILENAME)),
        metafields: openStream(join(snapshotDir, METAFIELDS_FILENAME)),
        inventoryLevels: openStream(join(snapshotDir, INVENTORY_LEVELS_FILENAME)),
        metaobjects: openStream(join(snapshotDir, METAOBJECTS_FILENAME)),
        metaobjectDefinitions: openStream(join(snapshotDir, METAOBJECT_DEFINITIONS_FILENAME)),
        metafieldDefinitions: openStream(join(snapshotDir, METAFIELD_DEFINITIONS_FILENAME)),
      },
    };
  }

  async writeProducts(items: AsyncIterable<ProductRecord>): Promise<number> {
    const open = this.requireOpen();
    let count = 0;
    let variantCount = 0;
    for await (const item of items) {
      await writeLine(open.streams.products, JSON.stringify(item));
      count++;
      variantCount += item.variants.length;
    }
    this.counts.products = count;
    this.counts.variants = variantCount;
    return count;
  }

  async writeCollections(items: AsyncIterable<Collection>): Promise<number> {
    const open = this.requireOpen();
    let count = 0;
    for await (const item of items) {
      await writeLine(open.streams.collections, JSON.stringify(item));
      count++;
    }
    this.counts.collections = count;
    return count;
  }

  async writeMetafields(items: AsyncIterable<Metafield>): Promise<number> {
    const open = this.requireOpen();
    let count = 0;
    for await (const item of items) {
      await writeLine(open.streams.metafields, JSON.stringify(item));
      count++;
    }
    this.counts.metafields = count;
    return count;
  }

  async writeInventoryLevels(items: AsyncIterable<InventoryLevel>): Promise<number> {
    const open = this.requireOpen();
    let count = 0;
    for await (const item of items) {
      await writeLine(open.streams.inventoryLevels, JSON.stringify(item));
      count++;
    }
    this.counts.inventoryLevels = count;
    return count;
  }

  async writeMetaobjects(items: AsyncIterable<Metaobject>): Promise<number> {
    const open = this.requireOpen();
    let count = 0;
    for await (const item of items) {
      await writeLine(open.streams.metaobjects, JSON.stringify(item));
      count++;
    }
    this.counts.metaobjects = count;
    return count;
  }

  async writeMetaobjectDefinitions(items: AsyncIterable<MetaobjectDefinition>): Promise<number> {
    const open = this.requireOpen();
    let count = 0;
    for await (const item of items) {
      await writeLine(open.streams.metaobjectDefinitions, JSON.stringify(item));
      count++;
    }
    this.counts.metaobjectDefinitions = count;
    return count;
  }

  async writeMetafieldDefinitions(items: AsyncIterable<MetafieldDefinition>): Promise<number> {
    const open = this.requireOpen();
    let count = 0;
    for await (const item of items) {
      await writeLine(open.streams.metafieldDefinitions, JSON.stringify(item));
      count++;
    }
    this.counts.metafieldDefinitions = count;
    return count;
  }

  async finish(scope: ScopeFlags, options: FinishOptions = {}): Promise<SnapshotResult> {
    const open = this.requireOpen();
    await Promise.all([
      closeStream(open.streams.products),
      closeStream(open.streams.collections),
      closeStream(open.streams.metafields),
      closeStream(open.streams.inventoryLevels),
      closeStream(open.streams.metaobjects),
      closeStream(open.streams.metaobjectDefinitions),
      closeStream(open.streams.metafieldDefinitions),
    ]);

    const manifest: Manifest = {
      version: 1,
      shop: this.shopDomain,
      capturedAt: new Date(open.startTime).toISOString(),
      apiVersion: options.apiVersion ?? SHOPIFY_API_VERSION,
      fallbackVersion: FALLBACK_VERSION,
      scope: {
        products: scope.products,
        collections: scope.collections,
        metafields: scope.metafields,
        inventoryLevels: scope.inventoryLevels,
        metaobjects: scope.metaobjects,
        metafieldOwnerTypes: scope.metafields ? [...CONTENT_METAFIELD_OWNER_TYPES] : [],
        themes: false,
        customers: false,
        orders: false,
        discounts: false,
      },
      counts: this.counts,
      durationMs: Date.now() - open.startTime,
      snapshotId: open.snapshotId,
    };
    ManifestSchema.parse(manifest);

    // The manifest is what marks a snapshot complete, so it must never exist half-written.
    const manifestPath = join(open.snapshotDir, MANIFEST_FILENAME);
    const tempPath = `${manifestPath}.tmp`;
    await writeFile(tempPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
    await rename(tempPath, manifestPath);

    const result: SnapshotResult = {
      snapshotId: open.snapshotId,
      snapshotDir: open.snapshotDir,
      manifestPath,
      counts: manifest.counts,
      durationMs: manifest.durationMs,
    };
    this.open = null;
    return result;
  }

  // A partial directory has no manifest, so every later list/diff — and the
  // scheduled sentinel — would trip over it; a failed capture must leave no trace.
  async abort(): Promise<void> {
    if (!this.open) return;
    const open = this.open;
    this.open = null;
    await Promise.allSettled([
      closeStream(open.streams.products),
      closeStream(open.streams.collections),
      closeStream(open.streams.metafields),
      closeStream(open.streams.inventoryLevels),
      closeStream(open.streams.metaobjects),
      closeStream(open.streams.metaobjectDefinitions),
      closeStream(open.streams.metafieldDefinitions),
    ]);
    await rm(open.snapshotDir, { recursive: true, force: true });
  }

  private requireOpen(): OpenSnapshot {
    if (!this.open) {
      throw new Error('SnapshotWriter.start() must be called before this method.');
    }
    return this.open;
  }
}

function defaultBaseDir(): string {
  return join(homedir(), '.fallback', 'snapshots');
}

function freshCounts(): ManifestCounts {
  return {
    products: 0,
    variants: 0,
    collections: 0,
    metafields: 0,
    inventoryLevels: 0,
    metaobjects: 0,
    metaobjectDefinitions: 0,
    metafieldDefinitions: 0,
  };
}

function formatSnapshotId(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}-${pad(d.getUTCSeconds())}Z`
  );
}

function openStream(path: string): WriteStream {
  const stream = createWriteStream(path, { encoding: 'utf-8' });
  // Write errors (ENOSPC, EIO) can arrive after the write that caused them has
  // returned. This listener keeps them from becoming uncaught exceptions; the
  // error is read back from stream.errored on the next write or close.
  stream.on('error', () => {});
  return stream;
}

function writeLine(stream: WriteStream, payload: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (stream.errored) {
      reject(stream.errored);
      return;
    }
    const onError = (err: Error) => {
      stream.off('drain', onDrain);
      reject(err);
    };
    const onDrain = () => {
      stream.off('error', onError);
      resolve();
    };
    stream.once('error', onError);
    if (stream.write(payload + '\n')) {
      stream.off('error', onError);
      resolve();
    } else {
      stream.once('drain', onDrain);
    }
  });
}

function closeStream(stream: WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    if (stream.errored) {
      reject(stream.errored);
      return;
    }
    stream.end((err?: Error | null) => {
      if (err) reject(err);
      else if (stream.errored) reject(stream.errored);
      else resolve();
    });
  });
}
