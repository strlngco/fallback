// packages/cli/src/diff/compute.ts
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import {
  ManifestSchema,
  SNAPSHOT_ID_PATTERN,
  diffResources,
  type FieldChangesConfig,
  type Manifest,
  type ManifestScope,
  type ResourceDiff,
  type SnapshotDiff,
} from '@strlngco/fallback-core';

import type {
  Collection,
  InventoryLevel,
  InventoryLevelsOptions,
  Metafield,
  MetafieldDefinition,
  Metaobject,
  MetaobjectDefinition,
  Product,
  ProductVariant,
  Requester,
} from '@strlngco/fallback-shopify';

import { InvalidOptionError, ScopeError, SnapshotNotFoundError } from '../env';
import { isENOENT } from '../output/paths';
import { parseScope } from '../commands/snapshot';
import { concatIterables, teeKeys } from '../snapshot/iterables';
import type { ProductRecord, ScopeFlags } from '../snapshot/writer';

export type FlatProduct = Product & { variants: ProductVariant[] };

// Stable-identity keying so reorders don't appear as diffs. variants on a product
// and products on a collection both reorder regularly in admin workflows and both
// expose a stable GID per item.
//
// ignorePaths suppresses changes that are technically real but practically uninteresting:
// updatedAt fires on every save; variant position and option-values reorder as side
// effects of variant reordering. Users can pass --show-ignored to see them anyway.
//
// variants[*].inventoryQuantity moves with every legitimate sale, so counting it as
// product drift turned every sales day into a false-positive report. Quantity has its
// own resource (inventory-levels) for callers who do want to track it.
export const PRODUCT_FIELD_CHANGES_CONFIG: FieldChangesConfig = {
  keyedArrays: {
    variants: (item) => String((item as { id?: unknown }).id ?? ''),
  },
  ignorePaths: [
    'updatedAt',
    'variants[*].updatedAt',
    'variants[*].position',
    'variants[*].inventoryQuantity',
    'options.0.values',
    'options.1.values',
    'options.2.values',
  ],
};

export const COLLECTION_FIELD_CHANGES_CONFIG: FieldChangesConfig = {
  keyedArrays: {
    products: (item) => String((item as { id?: unknown }).id ?? ''),
  },
  ignorePaths: ['updatedAt'],
};

export const METAFIELD_FIELD_CHANGES_CONFIG: FieldChangesConfig = {
  ignorePaths: ['updatedAt'],
};

// Metaobject entry fields are keyed by their field key so a single value edit diffs
// as fields[<key>].value instead of positional noise.
export const METAOBJECT_FIELD_CHANGES_CONFIG: FieldChangesConfig = {
  keyedArrays: {
    fields: (item) => String((item as { key?: unknown }).key ?? ''),
  },
  ignorePaths: ['updatedAt'],
};

export const METAOBJECT_DEFINITION_FIELD_CHANGES_CONFIG: FieldChangesConfig = {
  keyedArrays: {
    fieldDefinitions: (item) => String((item as { key?: unknown }).key ?? ''),
  },
};

export function stripIgnorePaths(config: FieldChangesConfig): FieldChangesConfig {
  const out: FieldChangesConfig = {};
  if (config.keyedArrays !== undefined) out.keyedArrays = config.keyedArrays;
  return out;
}

export interface DiffFetchers {
  products: (client: Requester) => AsyncIterable<ProductRecord>;
  collections: (client: Requester) => AsyncIterable<Collection>;
  metafields: (
    client: Requester,
    ownerIds: Iterable<string> | AsyncIterable<string>,
  ) => AsyncIterable<Metafield>;
  variantMetafields: (
    client: Requester,
    ownerIds: Iterable<string> | AsyncIterable<string>,
  ) => AsyncIterable<Metafield>;
  collectionMetafields: (
    client: Requester,
    ownerIds: Iterable<string> | AsyncIterable<string>,
  ) => AsyncIterable<Metafield>;
  shopMetafields: (client: Requester) => AsyncIterable<Metafield>;
  metafieldDefinitions: (
    client: Requester,
    ownerTypes: readonly string[],
  ) => AsyncIterable<MetafieldDefinition>;
  metaobjectDefinitions: (client: Requester) => AsyncIterable<MetaobjectDefinition>;
  metaobjects: (
    client: Requester,
    types: Iterable<string> | AsyncIterable<string>,
  ) => AsyncIterable<Metaobject>;
  inventoryLevels: (client: Requester, options?: InventoryLevelsOptions) => AsyncIterable<InventoryLevel>;
}

export interface ComputeDiffOptions {
  snapshotDir: string;
  snapshotId: string;
  shop: string;
  scope: ScopeFlags;
  client: Requester;
  fetchers: DiffFetchers;
  showIgnored: boolean;
  now: () => Date;
  // Coverage recorded in the manifest, not CLI capability — this is what keeps a diff
  // against an old snapshot fetching exactly what that snapshot captured.
  metafieldOwnerTypes: readonly string[];
  inventoryAllLocations: boolean;
  hasMetafieldDefinitions: boolean;
}

export async function computeSnapshotDiff(opts: ComputeDiffOptions): Promise<SnapshotDiff> {
  const { snapshotDir, scope, client, fetchers, showIgnored } = opts;
  const resources: Record<string, ResourceDiff<unknown>> = {};
  const productIds: string[] = [];
  const variantIds: string[] = [];
  const collectionIds: string[] = [];

  if (scope.products || scope.metafields) {
    const iter = fetchers.products(client);
    const tracksVariantIds = scope.metafields && opts.metafieldOwnerTypes.includes('PRODUCTVARIANT');
    const prepped = tracksVariantIds
      ? prepProducts(iter, productIds, variantIds)
      : prepProducts(iter, productIds);
    if (scope.products) {
      const productsDiff = await diffResources<FlatProduct>({
        snapshot: readProductsNdjson(join(snapshotDir, 'products.ndjson')),
        current: prepped,
        getId: (p) => p.id,
        fieldChangesConfig: showIgnored
          ? stripIgnorePaths(PRODUCT_FIELD_CHANGES_CONFIG)
          : PRODUCT_FIELD_CHANGES_CONFIG,
      });
      resources['products'] = productsDiff as ResourceDiff<unknown>;
    } else {
      for await (const _ of prepped) void _;
    }
  }

  // Collections are iterated whenever metafields coverage includes COLLECTION, even if
  // --scope excludes collections: collection metafields are owner-scoped, so this fetch
  // is how we get the collection IDs that drive the owner query. Mirrors products above.
  if (scope.collections || (scope.metafields && opts.metafieldOwnerTypes.includes('COLLECTION'))) {
    const iter = teeKeys(fetchers.collections(client), (c) => c.id, collectionIds);
    if (scope.collections) {
      const collectionsDiff = await diffResources<Collection>({
        snapshot: readNdjson<Collection>(join(snapshotDir, 'collections.ndjson')),
        current: iter,
        getId: (c) => c.id,
        fieldChangesConfig: showIgnored
          ? stripIgnorePaths(COLLECTION_FIELD_CHANGES_CONFIG)
          : COLLECTION_FIELD_CHANGES_CONFIG,
      });
      resources['collections'] = collectionsDiff as ResourceDiff<unknown>;
    } else {
      for await (const _ of iter) void _;
    }
  }

  if (scope.metafields) {
    const metafieldSources = [fetchers.metafields(client, productIds)];
    if (opts.metafieldOwnerTypes.includes('PRODUCTVARIANT')) {
      metafieldSources.push(fetchers.variantMetafields(client, variantIds));
    }
    if (opts.metafieldOwnerTypes.includes('COLLECTION')) {
      metafieldSources.push(fetchers.collectionMetafields(client, collectionIds));
    }
    if (opts.metafieldOwnerTypes.includes('SHOP')) {
      metafieldSources.push(fetchers.shopMetafields(client));
    }

    const metafieldsDiff = await diffResources<Metafield>({
      snapshot: readNdjson<Metafield>(join(snapshotDir, 'metafields.ndjson')),
      current: concatIterables(...metafieldSources),
      getId: metafieldKey,
      fieldChangesConfig: showIgnored
        ? stripIgnorePaths(METAFIELD_FIELD_CHANGES_CONFIG)
        : METAFIELD_FIELD_CHANGES_CONFIG,
    });
    resources['metafields'] = metafieldsDiff as ResourceDiff<unknown>;

    if (opts.hasMetafieldDefinitions) {
      const definitionsDiff = await diffResources<MetafieldDefinition>({
        snapshot: readNdjson<MetafieldDefinition>(join(snapshotDir, 'metafield-definitions.ndjson')),
        current: fetchers.metafieldDefinitions(client, opts.metafieldOwnerTypes),
        getId: metafieldDefinitionKey,
      });
      resources['metafieldDefinitions'] = definitionsDiff as ResourceDiff<unknown>;
    }
  }

  if (scope.inventoryLevels) {
    const levelsDiff = await diffResources<InventoryLevel>({
      snapshot: readNdjson<InventoryLevel>(join(snapshotDir, 'inventory-levels.ndjson')),
      current: fetchers.inventoryLevels(client, { allLocations: opts.inventoryAllLocations }),
      getId: (l) => l.id,
    });
    resources['inventoryLevels'] = levelsDiff as ResourceDiff<unknown>;
  }

  if (scope.metaobjects) {
    const definitionTypes: string[] = [];
    // diffResources fully drains `current` before comparing against the snapshot, so
    // definitionTypes is fully populated before the entries fetch below begins — the
    // same sequencing the snapshot command relies on for its metaobjects capture.
    const definitionsDiff = await diffResources<MetaobjectDefinition>({
      snapshot: readNdjson<MetaobjectDefinition>(join(snapshotDir, 'metaobject-definitions.ndjson')),
      current: teeKeys(fetchers.metaobjectDefinitions(client), (d) => d.type, definitionTypes),
      getId: (d) => d.type,
      fieldChangesConfig: showIgnored
        ? stripIgnorePaths(METAOBJECT_DEFINITION_FIELD_CHANGES_CONFIG)
        : METAOBJECT_DEFINITION_FIELD_CHANGES_CONFIG,
    });
    resources['metaobjectDefinitions'] = definitionsDiff as ResourceDiff<unknown>;

    const entriesDiff = await diffResources<Metaobject>({
      snapshot: readNdjson<Metaobject>(join(snapshotDir, 'metaobjects.ndjson')),
      current: fetchers.metaobjects(client, definitionTypes),
      getId: (m) => m.id,
      fieldChangesConfig: showIgnored
        ? stripIgnorePaths(METAOBJECT_FIELD_CHANGES_CONFIG)
        : METAOBJECT_FIELD_CHANGES_CONFIG,
    });
    resources['metaobjects'] = entriesDiff as ResourceDiff<unknown>;
  }

  return {
    snapshotId: opts.snapshotId,
    shop: opts.shop,
    computedAt: opts.now().toISOString(),
    resources,
  };
}

export async function loadManifest(snapshotDir: string, snapshotId: string): Promise<Manifest> {
  // The id is a path segment; anything outside the id format could walk out of the shop directory.
  if (!SNAPSHOT_ID_PATTERN.test(snapshotId)) {
    throw new InvalidOptionError(
      `"${snapshotId}" is not a snapshot id. Snapshot ids look like 2026-05-06T14-30-22Z; run fallback list to see them.`,
    );
  }
  let raw: string;
  try {
    raw = await readFile(join(snapshotDir, 'manifest.json'), 'utf-8');
  } catch (err) {
    if (isENOENT(err)) {
      throw new SnapshotNotFoundError(`Snapshot ${snapshotId} not found at ${snapshotDir}.`);
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Snapshot manifest at ${snapshotDir} is not valid JSON.`);
  }
  const result = ManifestSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(
      `Snapshot manifest at ${snapshotDir} failed validation${issue ? ` at ${issue.path.join('.') || '<root>'}: ${issue.message}` : ''}.`,
    );
  }
  return result.data;
}

export function resolveDiffScope(input: string | undefined, manifestScope: ManifestScope): ScopeFlags {
  if (input === undefined) {
    return {
      products: manifestScope.products,
      collections: manifestScope.collections,
      metafields: manifestScope.metafields,
      inventoryLevels: manifestScope.inventoryLevels,
      metaobjects: manifestScope.metaobjects === true,
    };
  }
  const requested = parseScope(input);
  const missing: string[] = [];
  if (requested.products && !manifestScope.products) missing.push('products');
  if (requested.collections && !manifestScope.collections) missing.push('collections');
  if (requested.metafields && !manifestScope.metafields) missing.push('metafields');
  if (requested.inventoryLevels && !manifestScope.inventoryLevels) missing.push('inventory-levels');
  if (requested.metaobjects && manifestScope.metaobjects !== true) missing.push('metaobjects');
  if (missing.length > 0) {
    throw new ScopeError(
      `--scope requested resources not captured in this snapshot: ${missing.join(', ')}. ` +
        `Snapshot scope was: ${describeScope(manifestScope)}.`,
    );
  }
  return requested;
}

export function describeScope(scope: ManifestScope): string {
  const enabled: string[] = [];
  if (scope.products) enabled.push('products');
  if (scope.collections) enabled.push('collections');
  if (scope.metafields) enabled.push('metafields');
  if (scope.inventoryLevels) enabled.push('inventory-levels');
  if (scope.metaobjects === true) enabled.push('metaobjects');
  return enabled.length > 0 ? enabled.join(', ') : 'none';
}

export function metafieldKey(m: Metafield): string {
  return `${m.ownerId}::${m.namespace}::${m.key}`;
}

export function metafieldDefinitionKey(d: MetafieldDefinition): string {
  return `${d.ownerType}::${d.namespace}::${d.key}`;
}

export async function* readNdjson<T>(path: string): AsyncIterable<T> {
  const stream = createReadStream(path, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      yield JSON.parse(trimmed) as T;
    }
  } finally {
    rl.close();
    stream.close();
  }
}

export async function* readProductsNdjson(path: string): AsyncIterable<FlatProduct> {
  for await (const record of readNdjson<ProductRecord>(path)) {
    yield flatten(record);
  }
}

export async function* prepProducts(
  iter: AsyncIterable<ProductRecord>,
  ids: string[],
  variantIds?: string[],
): AsyncIterable<FlatProduct> {
  for await (const r of iter) {
    ids.push(r.product.id);
    if (variantIds !== undefined) for (const v of r.variants) variantIds.push(v.id);
    yield flatten(r);
  }
}

export function flatten(r: ProductRecord): FlatProduct {
  return { ...r.product, variants: r.variants };
}
