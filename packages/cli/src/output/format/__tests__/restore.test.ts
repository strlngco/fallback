import { describe, expect, it } from 'vitest';
import type { RestorePlan, RestoreResult } from '@strlngco/fallback-core';
import { formatRestorePlan, formatRestorePlanSummary, formatRestoreResult } from '../restore';

function stripAnsi(lines: string[]): string {
  // eslint-disable-next-line no-control-regex
  return lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '');
}

const PLAN: RestorePlan = {
  snapshotId: '2026-06-01T00-00-00Z',
  shop: 'example.myshopify.com',
  builtAt: '2026-06-30T00:00:00.000Z',
  operations: [
    {
      resource: 'products',
      id: 'gid://shopify/Product/1',
      changes: [{ path: 'title', before: 'Old', after: 'New' }],
      targetRecord: {},
    },
  ],
  skipped: {
    created: [{ resource: 'products', id: 'gid://shopify/Product/2', reason: 'created since snapshot; restore does not recreate' }],
    deleted: [],
    unsupported: [{ resource: 'products', id: 'gid://shopify/Product/3', reason: 'no restorable fields changed' }],
  },
};

describe('formatRestorePlan', () => {
  it('renders the dry-run banner, the operation, its change, and skipped counts', () => {
    const out = stripAnsi(formatRestorePlan(PLAN));
    expect(out).toContain('Dry run — no changes written. Re-run with --apply to write.');
    expect(out).toContain('~ gid://shopify/Product/1');
    expect(out).toContain('title: "Old" → "New"');
    expect(out).toContain('Skipped (created): 1');
    expect(out).toContain('Skipped (unsupported): 1');
  });

  it('summarizes operations and skips as counts only', () => {
    const out = stripAnsi(formatRestorePlanSummary(PLAN));
    expect(out).toContain('Restore plan: 1 to write, 2 skipped');
  });
});

describe('formatRestoreResult', () => {
  it('renders counts and a Failed block with reasons', () => {
    const result: RestoreResult = {
      snapshotId: 's',
      shop: 'x',
      appliedAt: '2026-06-30T00:00:00.000Z',
      results: [
        { resource: 'products', id: 'gid://shopify/Product/1', status: 'restored' },
        { resource: 'metafields', id: 'gid://shopify/Product/9::custom::k', status: 'failed', error: 'invalid value' },
      ],
      skipped: { created: [], deleted: [], unsupported: [] },
      counts: { restored: 1, failed: 1, skipped: 0 },
    };
    const out = stripAnsi(formatRestoreResult(result));
    expect(out).toContain('Restored 1, failed 1, skipped 0');
    expect(out).toContain('Failed:');
    expect(out).toContain('gid://shopify/Product/9::custom::k: invalid value');
  });
});

describe('formatRestorePlan product operations', () => {
  function planFor(changes: RestorePlan['operations'][number]['changes']): RestorePlan {
    return {
      snapshotId: 's',
      shop: 'x',
      builtAt: '2026-11-21T00:00:00.000Z',
      operations: [
        {
          resource: 'products',
          id: 'gid://shopify/Product/9',
          changes,
          targetRecord: {
            id: 'gid://shopify/Product/9',
            title: 'The Complete Snowboard',
            variants: [{ id: 'gid://shopify/ProductVariant/68090405060973', title: 'Ice' }],
          },
        },
      ],
      skipped: { created: [], deleted: [], unsupported: [] },
    };
  }

  it('names the product by its snapshot title, with the GID alongside', () => {
    const out = stripAnsi(formatRestorePlan(planFor([{ path: 'title', before: 'Sale', after: 'The Complete Snowboard' }])));
    expect(out).toContain('  ~ The Complete Snowboard (gid://shopify/Product/9)');
  });

  it('names a variant by title and shows a price without .amount or quotes', () => {
    const out = stripAnsi(
      formatRestorePlan(
        planFor([
          {
            path: 'variants[gid://shopify/ProductVariant/68090405060973].price.amount',
            before: '559.96',
            after: '699.95',
          },
        ]),
      ),
    );
    expect(out).toContain('      Ice / price: 559.96 → 699.95');
  });

  it('keeps the id-only line for non-product resources', () => {
    const plan: RestorePlan = {
      ...PLAN,
      operations: [
        {
          resource: 'metafields',
          id: 'gid://shopify/Product/9::custom::k',
          changes: [{ path: 'value', before: 'a', after: 'b' }],
          targetRecord: { namespace: 'custom', key: 'k' },
        },
      ],
    };
    expect(stripAnsi(formatRestorePlan(plan))).toContain('  ~ gid://shopify/Product/9::custom::k (metafields)');
  });
});
