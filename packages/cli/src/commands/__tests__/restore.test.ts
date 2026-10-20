// packages/cli/src/commands/__tests__/restore.test.ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { Cli } from 'clipanion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Manifest, RestoreOperation } from '@strlngco/fallback-core';
import { PartialProductRestoreError, ShopifyUserError, type Metafield, type Metaobject, type MetaobjectDefinition } from '@strlngco/fallback-shopify';
import type { ProductRecord } from '../../snapshot/writer';
import { RestoreCommand, type RestoreContext, type RestoreDependencies } from '../restore';

const SHOP = 'example.myshopify.com';
const SNAPSHOT_ID = '2026-05-29T04-24-50Z';

async function* asAsync<T>(items: T[]): AsyncIterable<T> {
  for (const i of items) yield i;
}
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function buildProductRecord(title: string, id = 'gid://shopify/Product/1'): ProductRecord {
  return {
    product: {
      id, handle: 'tee', title, descriptionHtml: '', productType: '', vendor: '', tags: [],
      status: 'ACTIVE', templateSuffix: null, options: [], seo: { title: null, description: null },
      createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z', publishedAt: null,
    },
    variants: [{
      id: 'gid://shopify/ProductVariant/100', product: { id }, title: 'Default', sku: 'S', barcode: null,
      price: { amount: '10.00', currencyCode: 'USD' }, compareAtPrice: null, position: 1,
      inventoryPolicy: 'DENY', inventoryQuantity: 0, taxable: true, taxCode: null, selectedOptions: [],
      inventoryItem: { id: 'gid://shopify/InventoryItem/1', tracked: true, requiresShipping: true, measurement: { weight: null } },
      createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z',
    }],
  };
}

function buildManifest(overrides: Partial<Manifest['scope']> = {}): Manifest {
  return {
    version: 1, shop: SHOP, capturedAt: '2026-05-29T04:24:50.000Z', apiVersion: '2026-04',
    fallbackVersion: '0.1.0',
    scope: { products: true, collections: true, metafields: true, inventoryLevels: true, themes: false, customers: false, orders: false, discounts: false, ...overrides },
    counts: { products: 1, variants: 1, collections: 0, metafields: 0, inventoryLevels: 0 },
    durationMs: 1, snapshotId: SNAPSHOT_ID,
  };
}

async function setupSnapshot(
  baseDir: string,
  products: ProductRecord[],
  manifest = buildManifest(),
  metafields: Metafield[] = [],
  metaobjects: Metaobject[] = [],
  metaobjectDefinitions: MetaobjectDefinition[] = [],
): Promise<void> {
  const dir = join(baseDir, SHOP, SNAPSHOT_ID);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  await writeFile(join(dir, 'products.ndjson'), products.map((p) => JSON.stringify(p)).join('\n') + (products.length ? '\n' : ''), 'utf-8');
  await writeFile(join(dir, 'collections.ndjson'), '', 'utf-8');
  await writeFile(join(dir, 'metafields.ndjson'), metafields.map((m) => JSON.stringify(m)).join('\n') + (metafields.length ? '\n' : ''), 'utf-8');
  await writeFile(join(dir, 'inventory-levels.ndjson'), '', 'utf-8');
  if (manifest.scope.metafieldOwnerTypes !== undefined) {
    await writeFile(join(dir, 'metafield-definitions.ndjson'), '', 'utf-8');
  }
  if (manifest.scope.metaobjects) {
    await writeFile(join(dir, 'metaobjects.ndjson'), metaobjects.map((m) => JSON.stringify(m)).join('\n') + (metaobjects.length ? '\n' : ''), 'utf-8');
    await writeFile(join(dir, 'metaobject-definitions.ndjson'), metaobjectDefinitions.map((d) => JSON.stringify(d)).join('\n') + (metaobjectDefinitions.length ? '\n' : ''), 'utf-8');
  }
}

function metaobjectFixture(overrides: Partial<Metaobject> = {}): Metaobject {
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

function metaobjectDefinitionFixture(overrides: Partial<MetaobjectDefinition> = {}): MetaobjectDefinition {
  return {
    id: 'gid://shopify/MetaobjectDefinition/1',
    type: 'care_guide',
    name: 'Care guide',
    description: null,
    displayNameKey: 'title',
    fieldDefinitions: [],
    ...overrides,
  };
}

function metafieldFixture(overrides: Partial<Metafield> = {}): Metafield {
  return {
    id: 'gid://shopify/Metafield/1',
    ownerId: 'gid://shopify/Product/1',
    ownerType: 'PRODUCT',
    namespace: 'custom',
    key: 'field',
    type: 'single_line_text_field',
    value: 'before',
    description: null,
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

function makeDeps(current: ProductRecord[], overrides: Partial<RestoreDependencies> = {}): RestoreDependencies {
  return {
    buildClient: vi.fn(() => ({
      request: vi.fn(),
      getGrantedScopes: vi.fn(async () => ['read_products', 'write_products']),
    })) as unknown as RestoreDependencies['buildClient'],
    fetchers: {
      products: vi.fn(() => asAsync(current)),
      collections: vi.fn(() => asAsync([])),
      metafields: vi.fn(() => asAsync([])),
      variantMetafields: vi.fn(() => asAsync([])),
      collectionMetafields: vi.fn(() => asAsync([])),
      shopMetafields: vi.fn(() => asAsync([])),
      metafieldDefinitions: vi.fn(() => asAsync([])),
      metaobjectDefinitions: vi.fn(() => asAsync([])),
      metaobjects: vi.fn(() => asAsync([])),
      inventoryLevels: vi.fn(() => asAsync([])),
    },
    mutators: {
      restoreProduct: vi.fn(async () => undefined),
      restoreMetafields: vi.fn(async () => undefined),
      restoreMetaobject: vi.fn(async () => undefined),
    },
    resolveAuth: vi.fn().mockResolvedValue({ shopDomain: SHOP, clientId: 'c', clientSecret: 's', apiVersion: '2026-04' }),
    now: () => new Date('2026-06-30T00:00:00.000Z'),
    cwd: () => '/tmp/cwd',
    homeDir: () => '/tmp/home',
    env: () => ({}),
    ...overrides,
  };
}

// currentMetafields carries the drifted current-store values; the snapshot's before-values
// are set up separately via setupSnapshot so the diff sees these as updated, not created.
function makeDepsWithDriftedMetafields(currentMetafields: Metafield[]): RestoreDependencies {
  return makeDeps([buildProductRecord('Same')], {
    fetchers: {
      products: vi.fn(() => asAsync([buildProductRecord('Same')])),
      collections: vi.fn(() => asAsync([])),
      metafields: vi.fn(() => asAsync(currentMetafields.filter((m) => m.ownerType === 'PRODUCT'))),
      variantMetafields: vi.fn(() => asAsync([])),
      collectionMetafields: vi.fn(() => asAsync([])),
      shopMetafields: vi.fn(() => asAsync(currentMetafields.filter((m) => m.ownerType === 'SHOP'))),
      metafieldDefinitions: vi.fn(() => asAsync([])),
      metaobjectDefinitions: vi.fn(() => asAsync([])),
      metaobjects: vi.fn(() => asAsync([])),
      inventoryLevels: vi.fn(() => asAsync([])),
    },
  });
}

async function run(args: string[], deps: RestoreDependencies): Promise<{ exit: number; stdout: string; stderr: string }> {
  const outChunks: Buffer[] = [];
  const errChunks: Buffer[] = [];
  const stdout = new Writable({ write(c, _e, cb) { outChunks.push(Buffer.from(c)); cb(); } });
  const stderr = new Writable({ write(c, _e, cb) { errChunks.push(Buffer.from(c)); cb(); } });
  const cli = new Cli<RestoreContext>({ binaryName: 'fallback' });
  cli.register(RestoreCommand);
  const exit = await cli.run(args, { stdin: Readable.from([]), stdout, stderr, env: { ...process.env, NO_COLOR: '1' }, colorDepth: 0, deps });
  return { exit: exit ?? 0, stdout: Buffer.concat(outChunks).toString('utf-8'), stderr: stripAnsi(Buffer.concat(errChunks).toString('utf-8')) };
}

let baseDir: string;
beforeEach(async () => { baseDir = await mkdtemp(join(tmpdir(), 'fallback-restore-test-')); });
afterEach(async () => { await rm(baseDir, { recursive: true, force: true }); });

describe('RestoreCommand (dry-run)', () => {
  it('prints the plan and writes nothing by default', async () => {
    await setupSnapshot(baseDir, [buildProductRecord('Old')]);
    const deps = makeDeps([buildProductRecord('New')]);
    const { exit, stderr } = await run(['restore', SNAPSHOT_ID, '--base-dir', baseDir], deps);
    expect(exit).toBe(0);
    expect(stderr).toContain('Dry run — no changes written');
    expect(stderr).toContain('title: "New" → "Old"');
    expect(deps.mutators.restoreProduct).not.toHaveBeenCalled();
  });

  it('names the target store on the first line', async () => {
    await setupSnapshot(baseDir, [buildProductRecord('Old')]);
    const { stderr } = await run(['restore', SNAPSHOT_ID, '--base-dir', baseDir], makeDeps([buildProductRecord('New')]));
    expect(stderr.split('\n')[0]).toBe(`Planning restore of ${SHOP} to snapshot ${SNAPSHOT_ID}`);
  });

  it('previews the plan on read-only scopes (does not require write_products)', async () => {
    await setupSnapshot(baseDir, [buildProductRecord('Old')]);
    const deps = makeDeps([buildProductRecord('New')], {
      buildClient: vi.fn(() => ({ request: vi.fn(), getGrantedScopes: vi.fn(async () => ['read_products']) })) as unknown as RestoreDependencies['buildClient'],
    });
    const { exit, stderr } = await run(['restore', SNAPSHOT_ID, '--base-dir', baseDir], deps);
    expect(exit).toBe(0);
    expect(stderr).toContain('Dry run — no changes written');
    expect(stderr).toContain('title: "New" → "Old"');
    expect(deps.mutators.restoreProduct).not.toHaveBeenCalled();
  });

  it('rejects a snapshot id that is not in snapshot id format', async () => {
    const { exit, stderr } = await run(['restore', '../../elsewhere', '--base-dir', baseDir], makeDeps([]));
    expect(exit).toBe(1);
    expect(stderr).toContain('is not a snapshot id');
  });

  it('exits 1 when the snapshot does not exist', async () => {
    const { exit, stderr } = await run(['restore', '2099-01-01T00-00-00Z', '--base-dir', baseDir], makeDeps([]));
    expect(exit).toBe(1);
    expect(stderr).toContain('not found');
  });

  it('exits 1 when --scope requests a resource restore does not support', async () => {
    await setupSnapshot(baseDir, [buildProductRecord('Old')]);
    const { exit, stderr } = await run(['restore', SNAPSHOT_ID, '--base-dir', baseDir, '--scope', 'collections'], makeDeps([]));
    expect(exit).toBe(1);
    expect(stderr).toContain('restore supports');
  });

  it('emits the plan as JSON with --json', async () => {
    await setupSnapshot(baseDir, [buildProductRecord('Old')]);
    const deps = makeDeps([buildProductRecord('New')]);
    const { exit, stdout, stderr } = await run(['restore', SNAPSHOT_ID, '--base-dir', baseDir, '--json'], deps);
    expect(exit).toBe(0);
    expect(stderr).toBe('');
    const parsed = JSON.parse(stdout) as { operations: unknown[] };
    expect(parsed.operations).toHaveLength(1);
  });
});

describe('RestoreCommand (--apply)', () => {
  it('exits 1 without writing when write_products is not granted', async () => {
    await setupSnapshot(baseDir, [buildProductRecord('Old')]);
    const deps = makeDeps([buildProductRecord('New')], {
      buildClient: vi.fn(() => ({ request: vi.fn(), getGrantedScopes: vi.fn(async () => ['read_products']) })) as unknown as RestoreDependencies['buildClient'],
    });
    const { exit, stderr } = await run(['restore', SNAPSHOT_ID, '--base-dir', baseDir, '--apply'], deps);
    expect(exit).toBe(1);
    expect(stderr).toContain('write_products');
    expect(deps.mutators.restoreProduct).not.toHaveBeenCalled();
  });

  it('applies product restores and reports success, exit 0', async () => {
    await setupSnapshot(baseDir, [buildProductRecord('Old')]);
    const deps = makeDeps([buildProductRecord('New')]);
    const { exit, stderr } = await run(['restore', SNAPSHOT_ID, '--base-dir', baseDir, '--apply'], deps);
    expect(exit).toBe(0);
    expect(deps.mutators.restoreProduct).toHaveBeenCalledTimes(1);
    expect(stderr).toContain('Restored 1, failed 0, skipped 0');
    expect(stderr.split('\n')[0]).toBe(`Restoring ${SHOP} to snapshot ${SNAPSHOT_ID}`);
  });

  it('continues on a failed op and exits 2 with a Failed block', async () => {
    const manifest: Manifest = {
      version: 1, shop: SHOP, capturedAt: '2026-05-29T04:24:50.000Z', apiVersion: '2026-04',
      fallbackVersion: '0.1.0',
      scope: { products: true, collections: true, metafields: true, inventoryLevels: true, themes: false, customers: false, orders: false, discounts: false },
      counts: { products: 2, variants: 2, collections: 0, metafields: 0, inventoryLevels: 0 },
      durationMs: 1, snapshotId: SNAPSHOT_ID,
    };
    await setupSnapshot(
      baseDir,
      [buildProductRecord('Old 1', 'gid://shopify/Product/1'), buildProductRecord('Old 2', 'gid://shopify/Product/2')],
      manifest,
    );
    const deps = makeDeps(
      [buildProductRecord('New 1', 'gid://shopify/Product/1'), buildProductRecord('New 2', 'gid://shopify/Product/2')],
      {
        mutators: {
          restoreProduct: vi
            .fn()
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValue(undefined),
          restoreMetafields: vi.fn(async () => undefined),
          restoreMetaobject: vi.fn(async () => undefined),
        },
      },
    );
    const { exit, stderr } = await run(['restore', SNAPSHOT_ID, '--base-dir', baseDir, '--apply'], deps);
    expect(exit).toBe(2);
    expect(stderr).toContain('Restored 1, failed 1, skipped 0');
    expect(stderr).toContain('boom');
    expect(deps.mutators.restoreProduct).toHaveBeenCalledTimes(2);
  });

  it('reports what was written when a product is only partly restored', async () => {
    await setupSnapshot(baseDir, [buildProductRecord('Old')]);
    const partial = new PartialProductRestoreError(new Error('bad price'), ['product fields', '100 of 150 variants']);
    const deps = makeDeps([buildProductRecord('New')], {
      mutators: {
        restoreProduct: vi.fn().mockRejectedValue(partial),
        restoreMetafields: vi.fn(async () => undefined),
        restoreMetaobject: vi.fn(async () => undefined),
      },
    });
    const human = await run(['restore', SNAPSHOT_ID, '--base-dir', baseDir, '--apply'], deps);
    expect(human.exit).toBe(2);
    expect(human.stderr).toContain('bad price');
    expect(human.stderr).toContain(
      'Written before the failure: product fields, 100 of 150 variants. Run restore again to finish the rest.',
    );

    const json = await run(['restore', SNAPSHOT_ID, '--base-dir', baseDir, '--apply', '--json'], deps);
    const parsed = JSON.parse(json.stdout) as { results: Array<{ status: string; written?: string[] }> };
    expect(parsed.results[0]).toMatchObject({ status: 'failed', written: ['product fields', '100 of 150 variants'] });
  });

  it('emits the result as JSON with --apply --json', async () => {
    await setupSnapshot(baseDir, [buildProductRecord('Old')]);
    const deps = makeDeps([buildProductRecord('New')]);
    const { exit, stdout } = await run(['restore', SNAPSHOT_ID, '--base-dir', baseDir, '--apply', '--json'], deps);
    expect(exit).toBe(0);
    const parsed = JSON.parse(stdout) as { counts: { restored: number }; results: unknown[] };
    expect(parsed.counts.restored).toBe(1);
    expect(parsed.results).toHaveLength(1);
  });
});

describe('RestoreCommand (metafield batches)', () => {
  it('isolates a metafield Shopify rejects so the rest of its batch is still restored', async () => {
    const manifest = buildManifest({ metafieldOwnerTypes: ['PRODUCT'] });
    const keys = ['a', 'bad', 'c'];
    const snapshotMetafields = keys.map((key, i) =>
      metafieldFixture({ id: `gid://shopify/Metafield/${i + 1}`, key, value: 'before' }),
    );
    await setupSnapshot(baseDir, [buildProductRecord('Same')], manifest, snapshotMetafields);
    const deps = makeDepsWithDriftedMetafields(
      keys.map((key, i) => metafieldFixture({ id: `gid://shopify/Metafield/${i + 1}`, key, value: 'after' })),
    );
    const written: string[] = [];
    deps.mutators.restoreMetafields = vi.fn(async (_client: unknown, ops: RestoreOperation[]) => {
      const batchKeys = ops.map((op) => String((op.targetRecord as { key: string }).key));
      if (batchKeys.includes('bad')) {
        throw new ShopifyUserError('metafieldsSet', [{ field: ['metafields', '0', 'value'], message: 'Value is invalid' }]);
      }
      written.push(...batchKeys);
    });

    const { exit, stdout } = await run(['restore', SNAPSHOT_ID, '--base-dir', baseDir, '--apply', '--json'], deps);

    expect(exit).toBe(2);
    expect(written.sort()).toEqual(['a', 'c']);
    const result = JSON.parse(stdout) as {
      results: { resource: string; id: string; status: string; error?: string }[];
    };
    const metafieldResults = result.results.filter((r) => r.resource === 'metafields');
    expect(metafieldResults.filter((r) => r.status === 'restored')).toHaveLength(2);
    const failed = metafieldResults.filter((r) => r.status === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.id).toContain('bad');
    expect(failed[0]!.error).toContain('Value is invalid');
  });
});

describe('RestoreCommand (content guards)', () => {
  it('plans non-product metafields for restore', async () => {
    const manifest = buildManifest({ metafieldOwnerTypes: ['PRODUCT', 'SHOP'] });
    const snapshotMetafields = [
      metafieldFixture({
        id: 'gid://shopify/Metafield/1',
        ownerId: 'gid://shopify/Shop/1',
        ownerType: 'SHOP',
        value: 'before',
      }),
      metafieldFixture({
        id: 'gid://shopify/Metafield/2',
        ownerId: 'gid://shopify/Product/1',
        ownerType: 'PRODUCT',
        value: 'before',
      }),
    ];
    await setupSnapshot(baseDir, [buildProductRecord('Same')], manifest, snapshotMetafields);
    const deps = makeDepsWithDriftedMetafields([
      metafieldFixture({
        id: 'gid://shopify/Metafield/1',
        ownerId: 'gid://shopify/Shop/1',
        ownerType: 'SHOP',
        value: 'after',
      }),
      metafieldFixture({
        id: 'gid://shopify/Metafield/2',
        ownerId: 'gid://shopify/Product/1',
        ownerType: 'PRODUCT',
        value: 'after',
      }),
    ]);
    const { exit, stdout } = await run(['restore', SNAPSHOT_ID, '--base-dir', baseDir, '--json'], deps);
    expect(exit).toBe(0);
    const plan = JSON.parse(stdout) as { operations: { id: string }[]; skipped: { unsupported: unknown[] } };
    expect(plan.operations).toHaveLength(2);
    expect(plan.skipped.unsupported).toEqual([]);
  });

  it('accepts --scope metaobjects when the snapshot captured them', async () => {
    const manifest = buildManifest({ metaobjects: true });
    const entry = metaobjectFixture();
    const definition = metaobjectDefinitionFixture();
    await setupSnapshot(baseDir, [], manifest, [], [entry], [definition]);
    const deps = makeDeps([], {
      buildClient: vi.fn(() => ({
        request: vi.fn(),
        getGrantedScopes: vi.fn(async () => [
          'read_products',
          'read_metaobjects',
          'read_metaobject_definitions',
          'write_metaobjects',
        ]),
      })) as unknown as RestoreDependencies['buildClient'],
      fetchers: {
        products: vi.fn(() => asAsync([])),
        collections: vi.fn(() => asAsync([])),
        metafields: vi.fn(() => asAsync([])),
        variantMetafields: vi.fn(() => asAsync([])),
        collectionMetafields: vi.fn(() => asAsync([])),
        shopMetafields: vi.fn(() => asAsync([])),
        metafieldDefinitions: vi.fn(() => asAsync([])),
        metaobjectDefinitions: vi.fn(() => asAsync([definition])),
        metaobjects: vi.fn(() => asAsync([entry])),
        inventoryLevels: vi.fn(() => asAsync([])),
      },
    });
    const { exit } = await run(
      ['restore', SNAPSHOT_ID, '--base-dir', baseDir, '--scope', 'metaobjects'],
      deps,
    );
    expect(exit).toBe(0);
  });

  it('rejects --scope metaobjects when the snapshot did not capture them', async () => {
    await setupSnapshot(baseDir, [buildProductRecord('Old')]);
    const deps = makeDeps([buildProductRecord('New')]);
    const { exit, stderr } = await run(
      ['restore', SNAPSHOT_ID, '--base-dir', baseDir, '--scope', 'metaobjects'],
      deps,
    );
    expect(exit).toBe(1);
    expect(stderr).toContain('not captured');
  });

  it('requires write_metaobjects for --apply when metaobjects are in scope', async () => {
    const manifest = buildManifest({ metaobjects: true });
    const entry = metaobjectFixture();
    const definition = metaobjectDefinitionFixture();
    await setupSnapshot(baseDir, [buildProductRecord('Old')], manifest, [], [entry], [definition]);
    const deps = makeDeps([buildProductRecord('Old')], {
      buildClient: vi.fn(() => ({
        request: vi.fn(),
        getGrantedScopes: vi.fn(async () => [
          'read_products',
          'write_products',
          'read_metaobjects',
          'read_metaobject_definitions',
        ]),
      })) as unknown as RestoreDependencies['buildClient'],
      fetchers: {
        products: vi.fn(() => asAsync([buildProductRecord('Old')])),
        collections: vi.fn(() => asAsync([])),
        metafields: vi.fn(() => asAsync([])),
        variantMetafields: vi.fn(() => asAsync([])),
        collectionMetafields: vi.fn(() => asAsync([])),
        shopMetafields: vi.fn(() => asAsync([])),
        metafieldDefinitions: vi.fn(() => asAsync([])),
        metaobjectDefinitions: vi.fn(() => asAsync([definition])),
        metaobjects: vi.fn(() => asAsync([entry])),
        inventoryLevels: vi.fn(() => asAsync([])),
      },
    });
    const { exit, stderr } = await run(['restore', SNAPSHOT_ID, '--base-dir', baseDir, '--apply'], deps);
    expect(exit).toBe(1);
    expect(stderr).toContain('write_metaobjects');
  });

  it('runs the metaobject read preflight even on dry-run', async () => {
    const manifest = buildManifest({ metaobjects: true });
    const entry = metaobjectFixture();
    const definition = metaobjectDefinitionFixture();
    await setupSnapshot(baseDir, [buildProductRecord('Old')], manifest, [], [entry], [definition]);
    const deps = makeDeps([buildProductRecord('Old')], {
      buildClient: vi.fn(() => ({
        request: vi.fn(),
        getGrantedScopes: vi.fn(async () => ['read_products']),
      })) as unknown as RestoreDependencies['buildClient'],
    });
    const { exit, stderr } = await run(['restore', SNAPSHOT_ID, '--base-dir', baseDir], deps);
    expect(exit).toBe(1);
    expect(stderr).toContain('read_metaobjects');
    expect(stderr).toContain('Restoring metaobjects');
    expect(stderr).toContain('--scope products,metafields');
    expect(stderr).not.toContain('inventory-levels');
  });

  it('needs no metaobject scopes when --scope excludes them', async () => {
    const manifest = buildManifest({ metaobjects: true });
    await setupSnapshot(baseDir, [buildProductRecord('Old')], manifest);
    const deps = makeDeps([buildProductRecord('New')], {
      buildClient: vi.fn(() => ({
        request: vi.fn(),
        getGrantedScopes: vi.fn(async () => ['read_products', 'write_products']),
      })) as unknown as RestoreDependencies['buildClient'],
    });
    const { exit } = await run(
      ['restore', SNAPSHOT_ID, '--base-dir', baseDir, '--scope', 'products,metafields', '--apply'],
      deps,
    );
    expect(exit).toBe(0);
  });
});

describe('RestoreCommand (metaobjects apply)', () => {
  function driftedMetaobject(
    id: string,
    handle: string,
    value: string,
  ): Metaobject {
    return metaobjectFixture({
      id,
      handle,
      fields: [{ key: 'title', type: 'single_line_text_field', value }],
    });
  }

  function makeDepsWithDriftedMetaobjects(
    definition: MetaobjectDefinition,
    snapshotEntries: Metaobject[],
    currentEntries: Metaobject[],
    overrides: Partial<RestoreDependencies['mutators']> = {},
  ): RestoreDependencies {
    return makeDeps([], {
      buildClient: vi.fn(() => ({
        request: vi.fn(),
        getGrantedScopes: vi.fn(async () => [
          'read_products',
          'write_products',
          'read_metaobjects',
          'read_metaobject_definitions',
          'write_metaobjects',
        ]),
      })) as unknown as RestoreDependencies['buildClient'],
      fetchers: {
        products: vi.fn(() => asAsync([])),
        collections: vi.fn(() => asAsync([])),
        metafields: vi.fn(() => asAsync([])),
        variantMetafields: vi.fn(() => asAsync([])),
        collectionMetafields: vi.fn(() => asAsync([])),
        shopMetafields: vi.fn(() => asAsync([])),
        metafieldDefinitions: vi.fn(() => asAsync([])),
        metaobjectDefinitions: vi.fn(() => asAsync([definition])),
        metaobjects: vi.fn(() => asAsync(currentEntries)),
        inventoryLevels: vi.fn(() => asAsync([])),
      },
      mutators: {
        restoreProduct: vi.fn(async () => undefined),
        restoreMetafields: vi.fn(async () => undefined),
        restoreMetaobject: vi.fn(async () => undefined),
        ...overrides,
      },
    });
  }

  async function setupDriftedMetaobjectSnapshot(
    definition: MetaobjectDefinition,
    snapshotEntries: Metaobject[],
  ): Promise<void> {
    const manifest = buildManifest({ metaobjects: true });
    await setupSnapshot(baseDir, [], manifest, [], snapshotEntries, [definition]);
  }

  it('applies metaobject operations sequentially and continues on error', async () => {
    const definition = metaobjectDefinitionFixture();
    const before1 = driftedMetaobject('gid://shopify/Metaobject/1', 'wool', 'before-1');
    const before2 = driftedMetaobject('gid://shopify/Metaobject/2', 'cotton', 'before-2');
    const after1 = driftedMetaobject('gid://shopify/Metaobject/1', 'wool', 'after-1');
    const after2 = driftedMetaobject('gid://shopify/Metaobject/2', 'cotton', 'after-2');
    await setupDriftedMetaobjectSnapshot(definition, [before1, before2]);
    const deps = makeDepsWithDriftedMetaobjects(definition, [before1, before2], [after1, after2], {
      restoreMetaobject: vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(undefined),
    });

    const { exit, stdout } = await run(
      ['restore', SNAPSHOT_ID, '--base-dir', baseDir, '--apply', '--json'],
      deps,
    );

    expect(exit).toBe(2);
    const result = JSON.parse(stdout) as {
      results: { resource: string; status: string }[];
      counts: { failed: number };
    };
    const metaobjectResults = result.results.filter((r) => r.resource === 'metaobjects');
    expect(metaobjectResults).toHaveLength(2);
    expect(metaobjectResults.map((r) => r.status).sort()).toEqual(['failed', 'restored']);
    expect(deps.mutators.restoreMetaobject).toHaveBeenCalledTimes(2);
    expect(result.counts.failed).toBe(1);
  });

  it('does not call restoreMetaobject on dry-run', async () => {
    const definition = metaobjectDefinitionFixture();
    const before1 = driftedMetaobject('gid://shopify/Metaobject/1', 'wool', 'before-1');
    const after1 = driftedMetaobject('gid://shopify/Metaobject/1', 'wool', 'after-1');
    await setupDriftedMetaobjectSnapshot(definition, [before1]);
    const deps = makeDepsWithDriftedMetaobjects(definition, [before1], [after1]);

    const { exit } = await run(['restore', SNAPSHOT_ID, '--base-dir', baseDir], deps);

    expect(exit).toBe(0);
    expect(deps.mutators.restoreMetaobject).not.toHaveBeenCalled();
  });
});
