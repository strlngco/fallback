import { describe, expect, it } from 'vitest';
import { MetafieldSchema } from '../metafield';

describe('MetafieldSchema', () => {
  const fixture = {
    id: 'gid://shopify/Metafield/300',
    ownerId: 'gid://shopify/Product/1',
    ownerType: 'PRODUCT',
    namespace: 'custom',
    key: 'care_guide',
    type: 'multi_line_text_field',
    value: 'Wash cold. Tumble dry low.',
    description: null,
    createdAt: '2026-05-01T12:00:00Z',
    updatedAt: '2026-05-02T12:00:00Z',
  };

  it('parses a representative metafield', () => {
    expect(() => MetafieldSchema.parse(fixture)).not.toThrow();
  });

  it('accepts a JSON-typed value as an opaque string (Shopify always returns metafield values as strings)', () => {
    const json = {
      ...fixture,
      type: 'json',
      value: '{"care": "wash cold"}',
    };
    expect(() => MetafieldSchema.parse(json)).not.toThrow();
  });

  it('rejects an empty namespace', () => {
    const bad = { ...fixture, namespace: '' };
    expect(() => MetafieldSchema.parse(bad)).toThrow();
  });

  it('rejects an ownerId that is not a Shopify GID', () => {
    const bad = { ...fixture, ownerId: 'product:1' };
    expect(() => MetafieldSchema.parse(bad)).toThrow();
  });
});
