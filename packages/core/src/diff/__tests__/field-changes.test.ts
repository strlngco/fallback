import { describe, expect, it } from 'vitest';
import { computeFieldChanges, deepEqual, pathMatchesIgnorePattern } from '../field-changes';
import type { FieldChangesConfig } from '../types';

// Tests written against the v1 return shape (FieldChange[] only). Wrap here to
// keep them legible against the post-v1 { changes, ignoredCount } return.
function changesOf(
  before: unknown,
  after: unknown,
  config?: FieldChangesConfig,
) {
  return computeFieldChanges(before, after, config).changes;
}

describe('computeFieldChanges', () => {
  it('returns empty when primitives are equal', () => {
    expect(changesOf(1, 1)).toEqual([]);
    expect(changesOf('a', 'a')).toEqual([]);
    expect(changesOf(true, true)).toEqual([]);
    expect(changesOf(null, null)).toEqual([]);
  });

  it('emits a root-level change when primitives differ', () => {
    expect(changesOf(1, 2)).toEqual([{ path: '<root>', before: 1, after: 2 }]);
  });

  it('emits a type change when types differ', () => {
    expect(changesOf('5', 5)).toEqual([{ path: '<root>', before: '5', after: 5 }]);
  });

  it('treats null as a value rather than a marker', () => {
    expect(changesOf({ a: null }, { a: 0 })).toEqual([
      { path: 'a', before: null, after: 0 },
    ]);
    expect(changesOf({ a: null }, { a: null })).toEqual([]);
  });

  it('reports a single object key that changed', () => {
    expect(changesOf({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual([
      { path: 'b', before: 2, after: 3 },
    ]);
  });

  it('reports keys added and removed', () => {
    const { changes } = computeFieldChanges({ a: 1, b: 2 }, { a: 1, c: 3 });
    expect(changes).toEqual(
      expect.arrayContaining([
        { path: 'b', before: 2 },
        { path: 'c', after: 3 },
      ]),
    );
    expect(changes).toHaveLength(2);
  });

  it('walks nested objects with dot notation', () => {
    expect(
      changesOf(
        { product: { title: 'A', vendor: 'V' } },
        { product: { title: 'B', vendor: 'V' } },
      ),
    ).toEqual([{ path: 'product.title', before: 'A', after: 'B' }]);
  });

  it('walks deeply nested objects', () => {
    expect(
      changesOf({ a: { b: { c: { d: 1 } } } }, { a: { b: { c: { d: 2 } } } }),
    ).toEqual([{ path: 'a.b.c.d', before: 1, after: 2 }]);
  });

  it('emits a length change plus element changes when arrays differ in length', () => {
    const { changes } = computeFieldChanges([1, 2], [1, 2, 3]);
    expect(changes).toEqual([
      { path: 'length', before: 2, after: 3 },
      { path: '2', after: 3 },
    ]);
  });

  it('walks array elements by index', () => {
    expect(changesOf([1, 2, 3], [1, 9, 3])).toEqual([
      { path: '1', before: 2, after: 9 },
    ]);
  });

  it('walks nested arrays of objects', () => {
    expect(
      changesOf(
        { variants: [{ price: '10' }, { price: '20' }] },
        { variants: [{ price: '10' }, { price: '25' }] },
      ),
    ).toEqual([{ path: 'variants.1.price', before: '20', after: '25' }]);
  });

  it('returns empty for identical-but-different-reference objects', () => {
    const a = { id: 1, nested: { value: 'x' } };
    const b = { id: 1, nested: { value: 'x' } };
    expect(changesOf(a, b)).toEqual([]);
  });

  it('reports type change when one side is an array and the other is an object', () => {
    expect(changesOf([1, 2], { 0: 1, 1: 2 })).toEqual([
      { path: '<root>', before: [1, 2], after: { 0: 1, 1: 2 } },
    ]);
  });

  it('handles empty objects and empty arrays as no-change baselines', () => {
    expect(changesOf({}, {})).toEqual([]);
    expect(changesOf([], [])).toEqual([]);
  });
});

describe('computeFieldChanges with keyedArrays config', () => {
  const variantsConfig = {
    keyedArrays: { variants: (item: unknown) => (item as { id: string }).id },
  };

  it('treats a reordered keyed array with identical content as no change', () => {
    const before = {
      variants: [
        { id: 'v1', price: '10' },
        { id: 'v2', price: '20' },
        { id: 'v3', price: '30' },
      ],
    };
    const after = {
      variants: [
        { id: 'v3', price: '30' },
        { id: 'v1', price: '10' },
        { id: 'v2', price: '20' },
      ],
    };
    expect(changesOf(before, after, variantsConfig)).toEqual([]);
  });

  it("reports a field change inside a keyed item with the item's identity in the path", () => {
    const before = { variants: [{ id: 'v1', price: '10' }] };
    const after = { variants: [{ id: 'v1', price: '15' }] };
    expect(changesOf(before, after, variantsConfig)).toEqual([
      { path: 'variants[v1].price', before: '10', after: '15' },
    ]);
  });

  it('reports a created item in a keyed array (no before on the change)', () => {
    const before = { variants: [{ id: 'v1', price: '10' }] };
    const after = {
      variants: [
        { id: 'v1', price: '10' },
        { id: 'v2', price: '20' },
      ],
    };
    expect(changesOf(before, after, variantsConfig)).toEqual([
      { path: 'variants[v2]', after: { id: 'v2', price: '20' } },
    ]);
  });

  it('reports a deleted item in a keyed array (no after on the change)', () => {
    const before = {
      variants: [
        { id: 'v1', price: '10' },
        { id: 'v2', price: '20' },
      ],
    };
    const after = { variants: [{ id: 'v1', price: '10' }] };
    expect(changesOf(before, after, variantsConfig)).toEqual([
      { path: 'variants[v2]', before: { id: 'v2', price: '20' } },
    ]);
  });

  it('handles a mixed reorder + edit + add + delete', () => {
    const before = {
      variants: [
        { id: 'v1', price: '10' },
        { id: 'v2', price: '20' },
        { id: 'v3', price: '30' },
      ],
    };
    const after = {
      variants: [
        { id: 'v3', price: '30' },
        { id: 'v1', price: '11' },
        { id: 'v4', price: '40' },
      ],
    };
    const { changes } = computeFieldChanges(before, after, variantsConfig);
    expect(changes).toEqual(
      expect.arrayContaining([
        { path: 'variants[v2]', before: { id: 'v2', price: '20' } },
        { path: 'variants[v1].price', before: '10', after: '11' },
        { path: 'variants[v4]', after: { id: 'v4', price: '40' } },
      ]),
    );
    expect(changes).toHaveLength(3);
  });

  it('does not emit a length change for keyed arrays (per-item created/deleted carries that signal)', () => {
    const before = { variants: [{ id: 'v1', price: '10' }] };
    const after = {
      variants: [
        { id: 'v1', price: '10' },
        { id: 'v2', price: '20' },
      ],
    };
    const { changes } = computeFieldChanges(before, after, variantsConfig);
    expect(changes.some((c) => c.path === 'variants.length')).toBe(false);
  });

  it('falls back to index-based comparison when no config is provided', () => {
    expect(
      changesOf(
        [{ id: 'a' }, { id: 'b' }],
        [{ id: 'b' }, { id: 'a' }],
      ),
    ).toEqual([
      { path: '0.id', before: 'a', after: 'b' },
      { path: '1.id', before: 'b', after: 'a' },
    ]);
  });

  it('keys only the configured array path; nested arrays remain index-based unless keyed too', () => {
    const before = {
      variants: [
        { id: 'v1', options: [{ name: 'Size', value: 'S' }, { name: 'Color', value: 'red' }] },
      ],
    };
    const after = {
      variants: [
        { id: 'v1', options: [{ name: 'Color', value: 'red' }, { name: 'Size', value: 'S' }] },
      ],
    };
    const { changes } = computeFieldChanges(before, after, variantsConfig);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.every((c) => c.path.startsWith('variants[v1].options'))).toBe(true);
  });
});

describe('computeFieldChanges with ignorePaths', () => {
  it('skips emission at an exact-match ignored path', () => {
    const { changes } = computeFieldChanges(
      { title: 'A', updatedAt: '2026-05-28T00:00:00Z' },
      { title: 'B', updatedAt: '2026-05-29T00:00:00Z' },
      { ignorePaths: ['updatedAt'] },
    );
    expect(changes).toEqual([{ path: 'title', before: 'A', after: 'B' }]);
  });

  it('matches bracketed identity segments via [*] wildcard', () => {
    const { changes } = computeFieldChanges(
      {
        variants: [
          { id: 'gid://shopify/ProductVariant/1', price: '10', updatedAt: '2026-05-28T00:00:00Z' },
        ],
      },
      {
        variants: [
          { id: 'gid://shopify/ProductVariant/1', price: '10', updatedAt: '2026-05-29T00:00:00Z' },
        ],
      },
      {
        keyedArrays: { variants: (item) => (item as { id: string }).id },
        ignorePaths: ['variants[*].updatedAt'],
      },
    );
    expect(changes).toEqual([]);
  });

  it('mixes keyedArrays and ignorePaths in a single config', () => {
    const { changes } = computeFieldChanges(
      {
        variants: [
          { id: 'v1', price: '10', position: 1, updatedAt: 'old' },
          { id: 'v2', price: '20', position: 2, updatedAt: 'old' },
        ],
      },
      {
        variants: [
          { id: 'v2', price: '20', position: 1, updatedAt: 'new' },
          { id: 'v1', price: '15', position: 2, updatedAt: 'new' },
        ],
      },
      {
        keyedArrays: { variants: (item) => (item as { id: string }).id },
        ignorePaths: ['variants[*].position', 'variants[*].updatedAt'],
      },
    );
    expect(changes).toEqual([
      { path: 'variants[v1].price', before: '10', after: '15' },
    ]);
  });

  it('empty ignorePaths is a no-op', () => {
    const { changes } = computeFieldChanges(
      { title: 'A' },
      { title: 'B' },
      { ignorePaths: [] },
    );
    expect(changes).toEqual([{ path: 'title', before: 'A', after: 'B' }]);
  });

  it('handles deeply nested ignore paths', () => {
    expect(
      changesOf(
        { a: { b: { c: 1, d: 2 } } },
        { a: { b: { c: 9, d: 2 } } },
        { ignorePaths: ['a.b.c'] },
      ),
    ).toEqual([]);
    expect(
      changesOf(
        { a: { b: { c: 1, d: 2 } } },
        { a: { b: { c: 9, d: 8 } } },
        { ignorePaths: ['a.b.c'] },
      ),
    ).toEqual([{ path: 'a.b.d', before: 2, after: 8 }]);
  });

  it('skips the entire subtree under an ignored array path (no per-element noise)', () => {
    const { changes } = computeFieldChanges(
      { options: [{ values: ['M', 'S', 'L'] }] },
      { options: [{ values: ['S', 'M', 'L'] }] },
      { ignorePaths: ['options.0.values'] },
    );
    expect(changes).toEqual([]);
  });

  it('does not ignore sibling paths that share a prefix-without-segment-boundary', () => {
    const { changes } = computeFieldChanges(
      { updatedAt: 'A', updatedAtSibling: 'X' },
      { updatedAt: 'B', updatedAtSibling: 'Y' },
      { ignorePaths: ['updatedAt'] },
    );
    expect(changes).toEqual([
      { path: 'updatedAtSibling', before: 'X', after: 'Y' },
    ]);
  });
});

describe('computeFieldChanges ignoredCount', () => {
  it('counts a single suppressed scalar emission as 1', () => {
    const { ignoredCount } = computeFieldChanges(
      { title: 'A', updatedAt: 't1' },
      { title: 'B', updatedAt: 't2' },
      { ignorePaths: ['updatedAt'] },
    );
    expect(ignoredCount).toBe(1);
  });

  it('counts each per-variant ignored field separately', () => {
    const { ignoredCount } = computeFieldChanges(
      {
        variants: [
          { id: 'v1', position: 1 },
          { id: 'v2', position: 2 },
          { id: 'v3', position: 3 },
        ],
      },
      {
        variants: [
          { id: 'v1', position: 3 },
          { id: 'v2', position: 1 },
          { id: 'v3', position: 2 },
        ],
      },
      {
        keyedArrays: { variants: (item) => (item as { id: string }).id },
        ignorePaths: ['variants[*].position'],
      },
    );
    expect(ignoredCount).toBe(3);
  });

  it('counts each per-element emission in an ignored array reorder', () => {
    const { ignoredCount } = computeFieldChanges(
      { options: [{ values: ['S', 'M', 'L'] }] },
      { options: [{ values: ['L', 'S', 'M'] }] },
      { ignorePaths: ['options.0.values'] },
    );
    expect(ignoredCount).toBe(3);
  });

  it('is 0 when nothing is suppressed', () => {
    const { ignoredCount } = computeFieldChanges({ a: 1 }, { a: 2 });
    expect(ignoredCount).toBe(0);
  });
});

describe('pathMatchesIgnorePattern', () => {
  it('matches exact paths', () => {
    expect(pathMatchesIgnorePattern('updatedAt', 'updatedAt')).toBe(true);
    expect(pathMatchesIgnorePattern('title', 'updatedAt')).toBe(false);
  });

  it('matches sub-paths under the pattern (subtree match)', () => {
    expect(pathMatchesIgnorePattern('updatedAt.x', 'updatedAt')).toBe(true);
    expect(pathMatchesIgnorePattern('options.0.values.0', 'options.0.values')).toBe(true);
  });

  it('normalizes bracketed identity segments to [*] before comparing', () => {
    expect(
      pathMatchesIgnorePattern(
        'variants[gid://shopify/ProductVariant/123].updatedAt',
        'variants[*].updatedAt',
      ),
    ).toBe(true);
    expect(
      pathMatchesIgnorePattern('variants[gid://shopify/ProductVariant/123]', 'variants[*]'),
    ).toBe(true);
  });

  it('requires a segment boundary so updatedAt does not match updatedAtSibling', () => {
    expect(pathMatchesIgnorePattern('updatedAtSibling', 'updatedAt')).toBe(false);
  });
});

describe('deepEqual', () => {
  it('treats objects with same keys/values as equal regardless of reference', () => {
    expect(deepEqual({ a: { b: [1, 2] } }, { a: { b: [1, 2] } })).toBe(true);
  });

  it('returns false when null vs object', () => {
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual({}, null)).toBe(false);
  });

  it('returns false when arrays differ in length', () => {
    expect(deepEqual([1, 2, 3], [1, 2])).toBe(false);
  });
});
