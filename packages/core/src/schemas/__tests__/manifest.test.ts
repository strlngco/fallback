import { describe, expect, it } from 'vitest';
import { ManifestSchema } from '../manifest';

const validManifest = {
  version: 1 as const,
  shop: 'example.myshopify.com',
  capturedAt: '2026-05-06T14:30:22.123Z',
  apiVersion: '2026-04',
  fallbackVersion: '0.1.0',
  scope: {
    products: true,
    collections: true,
    metafields: true,
    inventoryLevels: true,
    themes: false as const,
    customers: false as const,
    orders: false as const,
    discounts: false as const,
  },
  counts: {
    products: 1247,
    variants: 3891,
    collections: 18,
    metafields: 524,
    inventoryLevels: 7782,
  },
  durationMs: 42103,
  snapshotId: '2026-05-06T14-30-22Z',
};

describe('ManifestSchema', () => {
  it('parses a representative v1 manifest', () => {
    expect(() => ManifestSchema.parse(validManifest)).not.toThrow();
  });

  it('accepts a partial-scope manifest (e.g. metafields skipped)', () => {
    const partial = {
      ...validManifest,
      scope: { ...validManifest.scope, metafields: false },
      counts: { ...validManifest.counts, metafields: 0 },
    };
    expect(() => ManifestSchema.parse(partial)).not.toThrow();
  });

  it('rejects a manifest version other than 1', () => {
    expect(() => ManifestSchema.parse({ ...validManifest, version: 2 })).toThrow();
    expect(() => ManifestSchema.parse({ ...validManifest, version: 0 })).toThrow();
  });

  it('rejects a deferred-resource scope set to true (themes must be literal false in v1)', () => {
    const bad = {
      ...validManifest,
      scope: { ...validManifest.scope, themes: true },
    };
    expect(() => ManifestSchema.parse(bad)).toThrow();
  });

  it('rejects a snapshotId that uses colons instead of dashes', () => {
    const bad = { ...validManifest, snapshotId: '2026-05-06T14:30:22Z' };
    expect(() => ManifestSchema.parse(bad)).toThrow();
  });

  it('rejects a capturedAt that is not ISO 8601', () => {
    const bad = { ...validManifest, capturedAt: 'May 6 2026 14:30' };
    expect(() => ManifestSchema.parse(bad)).toThrow();
  });

  it('rejects negative counts', () => {
    const bad = {
      ...validManifest,
      counts: { ...validManifest.counts, products: -1 },
    };
    expect(() => ManifestSchema.parse(bad)).toThrow();
  });

  it('rejects non-integer durationMs', () => {
    const bad = { ...validManifest, durationMs: 1.5 };
    expect(() => ManifestSchema.parse(bad)).toThrow();
  });

  it('rejects an empty shop domain', () => {
    const bad = { ...validManifest, shop: '' };
    expect(() => ManifestSchema.parse(bad)).toThrow();
  });
});
