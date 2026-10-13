import { describe, expect, it } from 'vitest';
import { ProductSchema } from '../product';

describe('ProductSchema', () => {
  const fixture = {
    id: 'gid://shopify/Product/1',
    handle: 'sample-tee',
    title: 'Sample Tee',
    descriptionHtml: '<p>A tee.</p>',
    productType: 'Shirts',
    vendor: 'Strlng',
    tags: ['summer', 'sale'],
    status: 'ACTIVE',
    templateSuffix: null,
    options: [
      {
        id: 'gid://shopify/ProductOption/10',
        name: 'Size',
        position: 1,
        values: ['S', 'M', 'L'],
      },
    ],
    seo: { title: 'Sample Tee', description: 'A tee.' },
    createdAt: '2026-05-01T12:00:00Z',
    updatedAt: '2026-05-02T12:00:00Z',
    publishedAt: '2026-05-01T12:00:00Z',
  };

  it('parses a representative active product', () => {
    expect(() => ProductSchema.parse(fixture)).not.toThrow();
  });

  it('accepts a draft product with no published date', () => {
    const draft = { ...fixture, status: 'DRAFT', publishedAt: null };
    expect(() => ProductSchema.parse(draft)).not.toThrow();
  });

  it('accepts UNLISTED status added by Shopify in 2025-10', () => {
    const unlisted = { ...fixture, status: 'UNLISTED' };
    expect(() => ProductSchema.parse(unlisted)).not.toThrow();
  });

  it('accepts hypothetical future Shopify status values for forward compatibility', () => {
    const future = { ...fixture, status: 'SOME_FUTURE_STATUS' };
    expect(() => ProductSchema.parse(future)).not.toThrow();
  });

  it('rejects an id that is not a Shopify GID', () => {
    const bad = { ...fixture, id: '12345' };
    expect(() => ProductSchema.parse(bad)).toThrow();
  });
});
