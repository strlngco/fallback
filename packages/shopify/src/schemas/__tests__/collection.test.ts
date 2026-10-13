import { describe, expect, it } from 'vitest';
import { CollectionSchema } from '../collection';

describe('CollectionSchema', () => {
  const customCollection = {
    id: 'gid://shopify/Collection/200',
    handle: 'summer-sale',
    title: 'Summer Sale',
    descriptionHtml: '<p>Summer.</p>',
    templateSuffix: null,
    sortOrder: 'MANUAL',
    image: null,
    seo: { title: null, description: null },
    ruleSet: null,
    products: [
      { id: 'gid://shopify/Product/1', handle: 'sample-tee' },
      { id: 'gid://shopify/Product/2', handle: 'sample-hoodie' },
    ],
    updatedAt: '2026-05-02T12:00:00Z',
  };

  const smartCollection = {
    id: 'gid://shopify/Collection/201',
    handle: 'on-sale',
    title: 'On Sale',
    descriptionHtml: '',
    templateSuffix: null,
    sortOrder: 'BEST_SELLING',
    image: {
      id: 'gid://shopify/CollectionImage/1',
      url: 'https://cdn.shopify.com/s/files/1/0001/0002/collections/on-sale.jpg',
      altText: null,
    },
    seo: { title: 'Sale', description: null },
    ruleSet: {
      appliedDisjunctively: false,
      rules: [
        { column: 'IS_PRICE_REDUCED', relation: 'EQUALS', condition: 'true' },
      ],
    },
    products: [],
    updatedAt: '2026-05-02T12:00:00Z',
  };

  it('parses a custom collection (manual sort, no rules)', () => {
    expect(() => CollectionSchema.parse(customCollection)).not.toThrow();
  });

  it('parses a smart collection (rule set, no products list)', () => {
    expect(() => CollectionSchema.parse(smartCollection)).not.toThrow();
  });

  it('rejects an unknown sort order', () => {
    const bad = { ...customCollection, sortOrder: 'RANDOM' };
    expect(() => CollectionSchema.parse(bad)).toThrow();
  });

  it('rejects a member with an empty handle', () => {
    const bad = {
      ...customCollection,
      products: [{ id: 'gid://shopify/Product/1', handle: '' }],
    };
    expect(() => CollectionSchema.parse(bad)).toThrow();
  });
});
