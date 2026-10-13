import { describe, expect, it } from 'vitest';
import {
  RestorePlanSchema,
  RestoreResultSchema,
  type RestorePlan,
  type RestoreResult,
} from '../types';

describe('restore schemas', () => {
  it('accepts a well-formed RestorePlan', () => {
    const plan: RestorePlan = {
      snapshotId: '2026-06-01T00-00-00Z',
      shop: 'example.myshopify.com',
      builtAt: '2026-06-30T00:00:00.000Z',
      operations: [
        {
          resource: 'products',
          id: 'gid://shopify/Product/1',
          changes: [{ path: 'title', before: 'A', after: 'B' }],
          targetRecord: { id: 'gid://shopify/Product/1', title: 'A' },
        },
      ],
      skipped: { created: [], deleted: [], unsupported: [] },
    };
    expect(RestorePlanSchema.parse(plan)).toEqual(plan);
  });

  it('accepts a well-formed RestoreResult', () => {
    const result: RestoreResult = {
      snapshotId: '2026-06-01T00-00-00Z',
      shop: 'example.myshopify.com',
      appliedAt: '2026-06-30T00:00:00.000Z',
      results: [{ resource: 'products', id: 'gid://shopify/Product/1', status: 'restored' }],
      skipped: { created: [], deleted: [], unsupported: [] },
      counts: { restored: 1, failed: 0, skipped: 0 },
    };
    expect(RestoreResultSchema.parse(result)).toEqual(result);
  });

  it('rejects an operation result with an unknown status', () => {
    expect(() =>
      RestoreResultSchema.parse({
        snapshotId: 's',
        shop: 'x',
        appliedAt: '2026-06-30T00:00:00.000Z',
        results: [{ resource: 'products', id: 'g', status: 'bogus' }],
        skipped: { created: [], deleted: [], unsupported: [] },
        counts: { restored: 0, failed: 0, skipped: 0 },
      }),
    ).toThrow();
  });
});
