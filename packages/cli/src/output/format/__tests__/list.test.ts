import { describe, expect, it } from 'vitest';
import type { Manifest, ManifestCounts, ManifestScope } from '@strlngco/fallback-core';

process.env.NO_COLOR = '1';

// Import AFTER NO_COLOR is set so picocolors picks it up.
const { formatListHuman } = await import('../list');

const manifest: Manifest = {
  version: 1,
  shop: 'ex.myshopify.com',
  capturedAt: '2026-05-28T10:00:00.000Z',
  apiVersion: '2025-01',
  fallbackVersion: '0.1.0',
  scope: {
    products: true, collections: true, metafields: false, inventoryLevels: false,
    themes: false, customers: false, orders: false, discounts: false,
  },
  counts: { products: 3, variants: 4, collections: 1, metafields: 0, inventoryLevels: 0 },
  durationMs: 1200,
  snapshotId: '2026-05-28T10-00-00Z',
};

// 5 minutes before manifest.capturedAt so relativeTime renders "in 5 minutes" —
// the pre-content-row assertion checks for the absence of the scope letter 'o',
// which "now" or an "...ago" phrasing would otherwise trip on.
const NOW = new Date('2026-05-28T09:55:00.000Z');

function fullScope(): ManifestScope {
  return {
    products: true, collections: true, metafields: true, inventoryLevels: true,
    themes: false, customers: false, orders: false, discounts: false,
  };
}

function fullCounts(): ManifestCounts {
  return { products: 3, variants: 4, collections: 1, metafields: 2, inventoryLevels: 5 };
}

function entryWith(overrides: { scope: ManifestScope; counts: ManifestCounts }) {
  return {
    shop: 'ex.myshopify.com',
    snapshotId: '2026-05-28T10-00-00Z',
    snapshotDir: '/snap',
    manifest: {
      ...manifest,
      scope: overrides.scope,
      counts: overrides.counts,
    },
    brokenReason: undefined,
    directorySize: 2048,
  };
}

describe('formatListHuman', () => {
  it('renders a healthy snapshot row under its shop header', () => {
    const now = new Date('2026-05-28T12:00:00.000Z');
    const lines = formatListHuman(
      [
        {
          shop: 'ex.myshopify.com',
          snapshotId: '2026-05-28T10-00-00Z',
          snapshotDir: '/snap',
          manifest,
          brokenReason: undefined,
          directorySize: 2048,
        },
      ],
      now,
    );
    expect(lines[0]).toBe('ex.myshopify.com');
    expect(lines[1]).toContain('SNAPSHOT ID');
    expect(lines[2]).toContain('2026-05-28T10-00-00Z');
    expect(lines[2]).toContain('p,c');
    expect(lines[2]).toContain('2 KB');
  });

  it('renders a broken snapshot with the broken marker and dashes', () => {
    const now = new Date('2026-05-28T12:00:00.000Z');
    const lines = formatListHuman(
      [
        {
          shop: 'ex.myshopify.com',
          snapshotId: '2026-05-28T09-00-00Z',
          snapshotDir: '/snap2',
          manifest: null,
          brokenReason: 'manifest.json missing',
          directorySize: 0,
        },
      ],
      now,
    );
    expect(lines.some((l) => l.includes('(broken: manifest.json missing)'))).toBe(true);
  });

  it('renders separator between shops but not before the first', () => {
    const now = new Date('2026-05-28T12:00:00.000Z');

    // Create a second shop's manifest
    const manifest2: Manifest = {
      ...manifest,
      shop: 'other.myshopify.com',
      snapshotId: '2026-05-28T11-00-00Z',
    };

    // Test with two shops
    const twoShopLines = formatListHuman(
      [
        {
          shop: 'ex.myshopify.com',
          snapshotId: '2026-05-28T10-00-00Z',
          snapshotDir: '/snap',
          manifest,
          brokenReason: undefined,
          directorySize: 2048,
        },
        {
          shop: 'other.myshopify.com',
          snapshotId: '2026-05-28T11-00-00Z',
          snapshotDir: '/snap-other',
          manifest: manifest2,
          brokenReason: undefined,
          directorySize: 4096,
        },
      ],
      now,
    );

    // Find the index of the second shop header
    const secondShopIndex = twoShopLines.indexOf('other.myshopify.com');
    expect(secondShopIndex).toBeGreaterThan(0);

    // Assert that the line before it is an empty string (the separator)
    expect(twoShopLines[secondShopIndex - 1]).toBe('');

    // Test with single shop — should have no separator
    const singleShopLines = formatListHuman(
      [
        {
          shop: 'ex.myshopify.com',
          snapshotId: '2026-05-28T10-00-00Z',
          snapshotDir: '/snap',
          manifest,
          brokenReason: undefined,
          directorySize: 2048,
        },
      ],
      now,
    );

    // First element should be the shop header, not empty
    expect(singleShopLines[0]).toBe('ex.myshopify.com');
    // Should not contain any empty string separators
    expect(singleShopLines).not.toContain('');
  });

  it('renders broken row with dash placeholders for scope, counts, and size', () => {
    const now = new Date('2026-05-28T12:00:00.000Z');
    const lines = formatListHuman(
      [
        {
          shop: 'ex.myshopify.com',
          snapshotId: '2026-05-28T09-00-00Z',
          snapshotDir: '/snap2',
          manifest: null,
          brokenReason: 'manifest.json missing',
          directorySize: 0,
        },
      ],
      now,
    );

    // The broken row should be after the shop header and column headers
    const brokenLine = lines[2];

    // Verify it contains the broken marker
    expect(brokenLine).toContain('(broken: manifest.json missing)');

    // Verify it contains padded dashes for scope, counts, size columns
    // The padded dashes appear as " - " pattern
    expect(brokenLine).toMatch(/ - /);
  });

  it('marks metaobjects in the scope column and appends their count', () => {
    const lines = formatListHuman(
      [
        entryWith({
          scope: { ...fullScope(), metaobjects: true, metafieldOwnerTypes: ['PRODUCT'] },
          counts: { ...fullCounts(), metaobjects: 4, metaobjectDefinitions: 1, metafieldDefinitions: 2 },
        }),
      ],
      NOW,
    );
    const row = lines[2] ?? '';
    expect(row).toContain('p,c,m,o,i');
    expect(row).toContain('4o');
  });

  it('renders pre-content manifests exactly as before', () => {
    const lines = formatListHuman([entryWith({ scope: fullScope(), counts: fullCounts() })], NOW);
    const row = lines[2] ?? '';
    expect(row).toContain('p,c,m,i');
    expect(row).not.toContain('o');
  });
});
