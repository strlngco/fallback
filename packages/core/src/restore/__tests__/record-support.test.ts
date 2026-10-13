import { describe, expect, it } from 'vitest';
import type { ResourceDiff, SnapshotDiff } from '../../diff/types';
import { buildRestorePlan } from '../build-plan';
import type { RestorePlanConfig } from '../types';

function diffWith(updated: ResourceDiff<unknown>['updated']): SnapshotDiff {
  return {
    snapshotId: 's',
    shop: 'x',
    computedAt: '2026-07-02T00:00:00.000Z',
    resources: {
      metafields: {
        created: [],
        updated,
        deleted: [],
        unchanged: 0,
        snapshotCount: updated.length,
        currentCount: updated.length,
        ignoredCount: 0,
      },
    },
  };
}

const CONFIG: RestorePlanConfig = {
  resources: {
    metafields: {
      supportedPaths: ['value', 'type'],
      getId: (r) => String((r as { id?: unknown }).id ?? ''),
      recordSupport: (r) =>
        (r as { ownerType?: unknown }).ownerType === 'PRODUCT'
          ? null
          : 'synthetic-exclusion-reason for records with ownerType SHOP',
    },
  },
};

const META = { snapshotId: 's', shop: 'x', builtAt: '2026-07-02T00:00:00.000Z' };

function updatedRecord(ownerType: string, id: string) {
  return {
    id,
    before: { id, ownerType, value: 'old' },
    after: { id, ownerType, value: 'new' },
    changes: [{ path: 'value', before: 'old', after: 'new' }],
    ignoredCount: 0,
  };
}

describe('recordSupport', () => {
  it('routes unsupported records to skipped.unsupported with the predicate reason', () => {
    const plan = buildRestorePlan({
      ...META,
      diff: diffWith([updatedRecord('SHOP', 'mf-1'), updatedRecord('PRODUCT', 'mf-2')]),
      config: CONFIG,
    });
    expect(plan.operations.map((op) => op.id)).toEqual(['mf-2']);
    expect(plan.skipped.unsupported).toEqual([
      {
        resource: 'metafields',
        id: 'mf-1',
        reason: 'synthetic-exclusion-reason for records with ownerType SHOP',
      },
    ]);
  });

  it('changes nothing when recordSupport is absent', () => {
    const config: RestorePlanConfig = {
      resources: {
        metafields: {
          supportedPaths: ['value', 'type'],
          getId: (r) => String((r as { id?: unknown }).id ?? ''),
        },
      },
    };
    const plan = buildRestorePlan({
      ...META,
      diff: diffWith([updatedRecord('SHOP', 'mf-1')]),
      config,
    });
    expect(plan.operations).toHaveLength(1);
  });
});
