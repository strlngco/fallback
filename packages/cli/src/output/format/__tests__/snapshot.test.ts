import { describe, expect, it } from 'vitest';
import { formatSnapshotSummary } from '../snapshot';

const summary = {
  snapshotId: '2026-05-29T04-24-50Z',
  manifestPath: '/snap/manifest.json',
  snapshotDir: '/snap',
  counts: { products: 412, variants: 980, collections: 87, metafields: 1200, inventoryLevels: 430 },
  durationMs: 8412,
  shop: 'ex.myshopify.com',
  scope: { products: true, collections: true, metafields: true, inventoryLevels: true, metaobjects: false },
};

describe('formatSnapshotSummary', () => {
  it('returns the summary lines verbatim, with a content line when metafields were captured', () => {
    expect(formatSnapshotSummary(summary)).toEqual([
      'Captured 412 products (980 variants), 87 collections, 1200 metafields, 430 inventory levels.',
      'Captured 0 metafield definitions.',
      'Snapshot ID: 2026-05-29T04-24-50Z',
      'Snapshot directory: /snap',
      'Duration: 8.4s',
    ]);
  });

  it('appends a content line when metaobjects or metafield definitions were captured', () => {
    const lines = formatSnapshotSummary({
      shop: 'x',
      snapshotId: 's',
      manifestPath: '/p',
      snapshotDir: '/d',
      durationMs: 1000,
      scope: { products: true, collections: true, metafields: true, inventoryLevels: true, metaobjects: true },
      counts: {
        products: 1,
        variants: 2,
        collections: 3,
        metafields: 4,
        inventoryLevels: 5,
        metaobjects: 6,
        metaobjectDefinitions: 2,
        metafieldDefinitions: 7,
      },
    });
    expect(lines[1]).toBe('Captured 6 metaobjects (2 definitions), 7 metafield definitions.');
  });

  it('emits no content line for a content-free scope', () => {
    const lines = formatSnapshotSummary({
      shop: 'x',
      snapshotId: 's',
      manifestPath: '/p',
      snapshotDir: '/d',
      durationMs: 1000,
      scope: { products: true, collections: false, metafields: false, inventoryLevels: false, metaobjects: false },
      counts: { products: 1, variants: 2, collections: 0, metafields: 0, inventoryLevels: 0 },
    });
    expect(lines[1]).toBe('Snapshot ID: s');
  });
});
