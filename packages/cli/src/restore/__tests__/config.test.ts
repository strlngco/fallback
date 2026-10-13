import { describe, expect, it } from 'vitest';
import { buildRestorePlan, type SnapshotDiff } from '@strlngco/fallback-core';
import { RESTORE_PLAN_CONFIG, RESTORE_RESOURCE_KEYS } from '../config';

const META = { snapshotId: 's', shop: 'x', builtAt: '2026-07-04T00:00:00.000Z' };

function emptyResource() {
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

function updated(id: string, before: Record<string, unknown>, path: string) {
  return {
    id,
    before,
    after: { ...before },
    changes: [{ path, before: 'old', after: 'new' }],
    ignoredCount: 0,
  };
}

function diffWith(resources: Record<string, unknown>): SnapshotDiff {
  return { snapshotId: 's', shop: 'x', computedAt: META.builtAt, resources } as SnapshotDiff;
}

describe('RESTORE_PLAN_CONFIG content entries', () => {
  it('locks the restorable resource keys', () => {
    expect(RESTORE_RESOURCE_KEYS).toEqual(['products', 'metafields', 'metaobjects']);
  });

  it('plans a metaobject field-value drift as an operation', () => {
    const entry = {
      id: 'gid://shopify/Metaobject/1',
      type: 'care_guide',
      handle: 'wool',
      fields: [{ key: 'note', type: 'multi_line_text_field', value: 'Wash cold.' }],
    };
    const plan = buildRestorePlan({
      ...META,
      diff: diffWith({
        metaobjects: {
          ...emptyResource(),
          updated: [updated('gid://shopify/Metaobject/1', entry, 'fields[note].value')],
        },
      }),
      config: RESTORE_PLAN_CONFIG,
    });
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]?.resource).toBe('metaobjects');
  });

  it('skips Shopify-managed metaobject types and app-owned metafield namespaces', () => {
    const managedEntry = {
      id: 'gid://shopify/Metaobject/2',
      type: 'shopify--color-pattern',
      handle: 'red',
      fields: [],
    };
    const appMetafield = {
      id: 'gid://shopify/Metafield/3',
      ownerId: 'gid://shopify/Product/1',
      ownerType: 'PRODUCT',
      namespace: 'app--999--secret',
      key: 'k',
      type: 'single_line_text_field',
      value: 'v',
    };
    const plan = buildRestorePlan({
      ...META,
      diff: diffWith({
        metaobjects: {
          ...emptyResource(),
          updated: [updated('gid://shopify/Metaobject/2', managedEntry, 'fields[c].value')],
        },
        metafields: {
          ...emptyResource(),
          updated: [
            updated('gid://shopify/Product/1::app--999--secret::k', appMetafield, 'value'),
          ],
        },
      }),
      config: RESTORE_PLAN_CONFIG,
    });
    expect(plan.operations).toHaveLength(0);
    expect(plan.skipped.unsupported).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resource: 'metaobjects', reason: 'Shopify-managed; not restored' }),
        expect.objectContaining({ resource: 'metafields', reason: 'app-owned namespace; not restored' }),
      ]),
    );
  });

  it('restores non-product metafields in plain namespaces (Increment A guard removed)', () => {
    const shopMetafield = {
      id: 'gid://shopify/Metafield/4',
      ownerId: 'gid://shopify/Shop/1',
      ownerType: 'SHOP',
      namespace: 'custom',
      key: 'policy',
      type: 'single_line_text_field',
      value: 'v1',
    };
    const plan = buildRestorePlan({
      ...META,
      diff: diffWith({
        metafields: {
          ...emptyResource(),
          updated: [updated('gid://shopify/Shop/1::custom::policy', shopMetafield, 'value')],
        },
      }),
      config: RESTORE_PLAN_CONFIG,
    });
    expect(plan.operations).toHaveLength(1);
  });

  it('reports definition drift as unsupported, never as an operation', () => {
    const metafieldDef = {
      id: 'gid://shopify/MetafieldDefinition/1',
      ownerType: 'PRODUCT',
      namespace: 'custom',
      key: 'material',
      name: 'Material',
      type: 'single_line_text_field',
      validations: [],
    };
    const metaobjectDef = {
      id: 'gid://shopify/MetaobjectDefinition/1',
      type: 'care_guide',
      name: 'Care guide',
      fieldDefinitions: [],
    };
    const plan = buildRestorePlan({
      ...META,
      diff: diffWith({
        metafieldDefinitions: {
          ...emptyResource(),
          updated: [updated('PRODUCT::custom::material', metafieldDef, 'name')],
        },
        metaobjectDefinitions: {
          ...emptyResource(),
          updated: [updated('care_guide', metaobjectDef, 'name')],
        },
      }),
      config: RESTORE_PLAN_CONFIG,
    });
    expect(plan.operations).toHaveLength(0);
    expect(plan.skipped.unsupported).toEqual([
      expect.objectContaining({
        resource: 'metafieldDefinitions',
        id: 'PRODUCT::custom::material',
        reason: 'definitions are not restorable',
      }),
      expect.objectContaining({
        resource: 'metaobjectDefinitions',
        id: 'care_guide',
        reason: 'definitions are not restorable',
      }),
    ]);
  });
});
