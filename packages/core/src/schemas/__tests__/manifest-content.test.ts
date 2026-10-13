import { describe, expect, it } from 'vitest';
import { ManifestSchema, manifestMetafieldOwnerTypes } from '../manifest';

const V1_MANIFEST = {
  version: 1,
  shop: 'example.myshopify.com',
  capturedAt: '2026-06-01T00:00:00.000Z',
  apiVersion: '2026-04',
  fallbackVersion: '0.2.0',
  scope: {
    products: true,
    collections: true,
    metafields: true,
    inventoryLevels: true,
    themes: false,
    customers: false,
    orders: false,
    discounts: false,
  },
  counts: { products: 1, variants: 2, collections: 3, metafields: 4, inventoryLevels: 5 },
  durationMs: 100,
  snapshotId: '2026-06-01T00-00-00Z',
};

describe('manifest content fields', () => {
  it('parses a pre-content manifest and re-serializes it without gaining keys', () => {
    const parsed = ManifestSchema.parse(V1_MANIFEST);
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(V1_MANIFEST));
  });

  it('parses a content manifest with coverage and metaobjects', () => {
    const manifest = {
      ...V1_MANIFEST,
      scope: {
        ...V1_MANIFEST.scope,
        metaobjects: true,
        metafieldOwnerTypes: ['PRODUCT', 'PRODUCTVARIANT', 'COLLECTION', 'SHOP'],
      },
      counts: {
        ...V1_MANIFEST.counts,
        metaobjects: 7,
        metaobjectDefinitions: 2,
        metafieldDefinitions: 9,
      },
    };
    expect(ManifestSchema.parse(manifest)).toEqual(manifest);
  });

  it('interprets absent coverage as product-only when metafields were captured', () => {
    const parsed = ManifestSchema.parse(V1_MANIFEST);
    expect(manifestMetafieldOwnerTypes(parsed.scope)).toEqual(['PRODUCT']);
  });

  it('returns empty coverage when metafields were not captured', () => {
    const parsed = ManifestSchema.parse({
      ...V1_MANIFEST,
      scope: { ...V1_MANIFEST.scope, metafields: false },
    });
    expect(manifestMetafieldOwnerTypes(parsed.scope)).toEqual([]);
  });

  it('uses the recorded coverage when present', () => {
    const parsed = ManifestSchema.parse({
      ...V1_MANIFEST,
      scope: { ...V1_MANIFEST.scope, metafieldOwnerTypes: ['PRODUCT', 'SHOP'] },
    });
    expect(manifestMetafieldOwnerTypes(parsed.scope)).toEqual(['PRODUCT', 'SHOP']);
  });
});
