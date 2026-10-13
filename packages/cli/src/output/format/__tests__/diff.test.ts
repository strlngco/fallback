import { describe, expect, it } from 'vitest';

process.env.NO_COLOR = '1';

// Import AFTER NO_COLOR is set so picocolors picks it up.
const { formatDiffHuman, formatDiffSummary } = await import('../diff');

function makeDiff(): import('@strlngco/fallback-core').SnapshotDiff {
  return {
    snapshotId: '2026-05-29T04-24-50Z',
    shop: 'ex.myshopify.com',
    computedAt: '2026-05-29T05:00:00.000Z',
    resources: {
      products: {
        created: [{ id: 'gid://shopify/Product/1', title: 'Aurora Jacket' }],
        updated: [
          {
            before: { id: 'gid://shopify/Product/2', title: 'Cobalt Tee' },
            after: { id: 'gid://shopify/Product/2', title: 'Cobalt Tee' },
            changes: [{ path: 'price', before: '20.00', after: '24.00' }],
          },
        ],
        deleted: [],
        snapshotCount: 2,
        currentCount: 2,
        ignoredCount: 0,
      },
      collections: {
        created: [],
        updated: [],
        deleted: [],
        snapshotCount: 12,
        currentCount: 12,
        ignoredCount: 0,
      },
    },
  } as unknown as import('@strlngco/fallback-core').SnapshotDiff;
}

function emptyResource(snapshotCount: number, currentCount: number) {
  return {
    created: [],
    updated: [],
    deleted: [],
    snapshotCount,
    currentCount,
    ignoredCount: 0,
  };
}

describe('formatDiffSummary', () => {
  it('emits one count line per present resource section', () => {
    expect(formatDiffSummary(makeDiff())).toEqual([
      'Products: +1 / ~1 / -0 (2 in snapshot, 2 in current)',
      'Collections: +0 / ~0 / -0 (12 in snapshot, 12 in current)',
    ]);
  });

  it('renders content sections after the existing four', () => {
    const lines = formatDiffSummary({
      snapshotId: 's',
      shop: 'x',
      computedAt: '2026-07-02T00:00:00.000Z',
      resources: {
        metaobjects: emptyResource(1, 1),
        metaobjectDefinitions: emptyResource(1, 1),
        metafieldDefinitions: emptyResource(2, 2),
      },
    } as unknown as import('@strlngco/fallback-core').SnapshotDiff);
    expect(lines).toEqual([
      'Metaobjects: +0 / ~0 / -0 (1 in snapshot, 1 in current)',
      'MetaobjectDefinitions: +0 / ~0 / -0 (1 in snapshot, 1 in current)',
      'MetafieldDefinitions: +0 / ~0 / -0 (2 in snapshot, 2 in current)',
    ]);
  });
});

describe('formatDiffHuman', () => {
  it('emits the human tree with a blank-line separator between sections', () => {
    expect(formatDiffHuman(makeDiff(), { showIgnored: false })).toEqual([
      'Products',
      '  Created: 1',
      '    + Aurora Jacket (gid://shopify/Product/1)',
      '  Updated: 1',
      '    ~ Cobalt Tee (gid://shopify/Product/2)',
      '        price: "20.00" → "24.00"',
      '  Deleted: 0',
      '',
      'Collections',
      '  No changes (12 in snapshot, 12 in current)',
    ]);
  });

  it('displays metaobjects as type/handle and definitions by their identity', () => {
    const diff = {
      snapshotId: 's',
      shop: 'x',
      computedAt: '2026-07-02T00:00:00.000Z',
      resources: {
        metaobjects: {
          ...emptyResource(1, 1),
          created: [{ id: 'gid://shopify/Metaobject/1', type: 'care_guide', handle: 'wool' }],
        },
        metafieldDefinitions: {
          ...emptyResource(1, 1),
          deleted: [
            {
              id: 'gid://shopify/MetafieldDefinition/1',
              ownerType: 'SHOP',
              namespace: 'custom',
              key: 'policy',
            },
          ],
        },
      },
    } as unknown as import('@strlngco/fallback-core').SnapshotDiff;
    const lines = formatDiffHuman(diff, { showIgnored: false }).join('\n');
    expect(lines).toContain('care_guide/wool');
    expect(lines).toContain('SHOP.custom.policy');
  });

  it('renders deleted rows with a "-" marker and the resource display name/id', () => {
    const diff = {
      snapshotId: 's',
      shop: 'x',
      computedAt: '2026-07-02T00:00:00.000Z',
      resources: {
        products: {
          ...emptyResource(1, 0),
          deleted: [{ id: 'gid://shopify/Product/9', title: 'Retired Hoodie' }],
        },
      },
    } as unknown as import('@strlngco/fallback-core').SnapshotDiff;
    expect(formatDiffHuman(diff, { showIgnored: false })).toEqual([
      'Products',
      '  Created: 0',
      '  Updated: 0',
      '  Deleted: 1',
      '    - Retired Hoodie (gid://shopify/Product/9)',
    ]);
  });

  it('renders every change inline when showIgnored bypasses the inline-change cap', () => {
    const diff = {
      snapshotId: 's',
      shop: 'x',
      computedAt: '2026-07-02T00:00:00.000Z',
      resources: {
        products: {
          ...emptyResource(1, 1),
          updated: [
            {
              before: { id: 'gid://shopify/Product/2', title: 'Cobalt Tee' },
              after: { id: 'gid://shopify/Product/2', title: 'Cobalt Tee' },
              changes: [
                { path: 'price', before: '20.00', after: '24.00' },
                { path: 'title', before: 'a', after: 'b' },
                { path: 'sku', before: 'a', after: 'b' },
                { path: 'tags', before: 'a', after: 'b' },
              ],
            },
          ],
        },
      },
    } as unknown as import('@strlngco/fallback-core').SnapshotDiff;
    const lines = formatDiffHuman(diff, { showIgnored: true }).join('\n');
    expect(lines).toContain('price: "20.00" → "24.00"');
    expect(lines).toContain('title: "a" → "b"');
    expect(lines).toContain('sku: "a" → "b"');
    expect(lines).toContain('tags: "a" → "b"');
    expect(lines).not.toContain('field changes — use --json for details');
  });

  it('summarizes updates past the inline-change cap when not showing ignored', () => {
    const diff = {
      snapshotId: 's',
      shop: 'x',
      computedAt: '2026-07-02T00:00:00.000Z',
      resources: {
        products: {
          ...emptyResource(1, 1),
          updated: [
            {
              before: { id: 'gid://shopify/Product/2', title: 'Cobalt Tee' },
              after: { id: 'gid://shopify/Product/2', title: 'Cobalt Tee' },
              changes: [
                { path: 'price', before: '20.00', after: '24.00' },
                { path: 'title', before: 'a', after: 'b' },
                { path: 'sku', before: 'a', after: 'b' },
                { path: 'tags', before: 'a', after: 'b' },
              ],
            },
          ],
        },
      },
    } as unknown as import('@strlngco/fallback-core').SnapshotDiff;
    const lines = formatDiffHuman(diff, { showIgnored: false });
    expect(lines).toContain('        4 field changes — use --json for details');
    expect(lines.join('\n')).not.toContain('price: "20.00"');
  });

  it('reports ignored changes and suppresses that line when showIgnored is set', () => {
    const diff = {
      snapshotId: 's',
      shop: 'x',
      computedAt: '2026-07-02T00:00:00.000Z',
      resources: {
        products: { ...emptyResource(1, 1), ignoredCount: 2 },
      },
    } as unknown as import('@strlngco/fallback-core').SnapshotDiff;
    const hidden = formatDiffHuman(diff, { showIgnored: false }).join('\n');
    expect(hidden).toContain('2 ignored changes (use --show-ignored to view)');

    const shown = formatDiffHuman(diff, { showIgnored: true }).join('\n');
    expect(shown).not.toContain('ignored changes');
  });
});
