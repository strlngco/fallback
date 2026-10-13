import { describe, expect, it } from 'vitest';
import type { ResourceDiff, SnapshotDiff } from '../../diff/types';
import { buildRestorePlan } from '../build-plan';
import type { RestorePlanConfig } from '../types';

function emptyResourceDiff(): ResourceDiff<unknown> {
  return {
    created: [],
    updated: [],
    deleted: [],
    unchanged: 0,
    snapshotCount: 0,
    currentCount: 0,
    ignoredCount: 0,
  };
}

const CONFIG: RestorePlanConfig = {
  resources: {
    products: {
      supportedPaths: ['title', 'tags', 'variants[*].price'],
      getId: (r) => String((r as { id?: unknown }).id ?? ''),
    },
  },
};

function diffWith(products: ResourceDiff<unknown>): SnapshotDiff {
  return {
    snapshotId: 's',
    shop: 'x',
    computedAt: '2026-06-30T00:00:00.000Z',
    resources: { products },
  };
}

const META = { snapshotId: 's', shop: 'x', builtAt: '2026-06-30T00:00:00.000Z' };

describe('buildRestorePlan', () => {
  it('turns a supported updated record into an operation that moves the current value back to the snapshot value', () => {
    const r = emptyResourceDiff();
    r.updated = [
      {
        id: 'gid://shopify/Product/1',
        before: { id: 'gid://shopify/Product/1', title: 'Old' },
        after: { id: 'gid://shopify/Product/1', title: 'New' },
        changes: [{ path: 'title', before: 'Old', after: 'New' }],
        ignoredCount: 0,
      },
    ];
    const plan = buildRestorePlan({ ...META, diff: diffWith(r), config: CONFIG });
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]).toEqual({
      resource: 'products',
      id: 'gid://shopify/Product/1',
      changes: [{ path: 'title', before: 'New', after: 'Old' }],
      targetRecord: { id: 'gid://shopify/Product/1', title: 'Old' },
    });
    expect(plan.skipped.unsupported).toHaveLength(0);
  });

  it('keeps only supported changes on the operation', () => {
    const r = emptyResourceDiff();
    r.updated = [
      {
        id: 'gid://shopify/Product/1',
        before: { id: 'gid://shopify/Product/1' },
        after: { id: 'gid://shopify/Product/1' },
        changes: [
          { path: 'title', before: 'A', after: 'B' },
          { path: 'options.0.name', before: 'Size', after: 'Sizes' },
        ],
        ignoredCount: 0,
      },
    ];
    const plan = buildRestorePlan({ ...META, diff: diffWith(r), config: CONFIG });
    expect(plan.operations[0]?.changes).toEqual([{ path: 'title', before: 'B', after: 'A' }]);
  });

  it('routes an updated record whose only drift is unsupported to skipped.unsupported', () => {
    const r = emptyResourceDiff();
    r.updated = [
      {
        id: 'gid://shopify/Product/1',
        before: {},
        after: {},
        changes: [{ path: 'options.0.name', before: 'Size', after: 'Sizes' }],
        ignoredCount: 0,
      },
    ];
    const plan = buildRestorePlan({ ...META, diff: diffWith(r), config: CONFIG });
    expect(plan.operations).toHaveLength(0);
    expect(plan.skipped.unsupported).toEqual([
      { resource: 'products', id: 'gid://shopify/Product/1', reason: 'no restorable fields changed' },
    ]);
  });

  it('matches keyed-array variant paths against the [*] supported pattern', () => {
    const r = emptyResourceDiff();
    r.updated = [
      {
        id: 'gid://shopify/Product/1',
        before: { id: 'gid://shopify/Product/1' },
        after: { id: 'gid://shopify/Product/1' },
        changes: [
          { path: 'variants[gid://shopify/ProductVariant/9].price.amount', before: '1', after: '2' },
        ],
        ignoredCount: 0,
      },
    ];
    const plan = buildRestorePlan({ ...META, diff: diffWith(r), config: CONFIG });
    expect(plan.operations).toHaveLength(1);
  });

  it('reports created and deleted records as skipped without acting on them', () => {
    const r = emptyResourceDiff();
    r.created = [{ id: 'gid://shopify/Product/2' }];
    r.deleted = [{ id: 'gid://shopify/Product/3' }];
    const plan = buildRestorePlan({ ...META, diff: diffWith(r), config: CONFIG });
    expect(plan.operations).toHaveLength(0);
    expect(plan.skipped.created).toEqual([
      { resource: 'products', id: 'gid://shopify/Product/2', reason: 'created since snapshot; restore does not recreate' },
    ]);
    expect(plan.skipped.deleted).toEqual([
      { resource: 'products', id: 'gid://shopify/Product/3', reason: 'deleted since snapshot; restore does not delete' },
    ]);
  });

  it('returns an empty plan for an empty diff', () => {
    const plan = buildRestorePlan({ ...META, diff: diffWith(emptyResourceDiff()), config: CONFIG });
    expect(plan.operations).toHaveLength(0);
    expect(plan.skipped).toEqual({ created: [], deleted: [], unsupported: [] });
  });
});
