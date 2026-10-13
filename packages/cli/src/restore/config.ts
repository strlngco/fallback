import type { RestorePlanConfig } from '@strlngco/fallback-core';
import {
  METAFIELD_SUPPORTED_PATHS,
  METAOBJECT_SUPPORTED_PATHS,
  PRODUCT_SUPPORTED_PATHS,
  VARIANT_SUPPORTED_PATHS,
  reservedContentReason,
} from '@strlngco/fallback-shopify';
import { metafieldDefinitionKey, metafieldKey } from '../diff/compute';
import type { Metafield, MetafieldDefinition } from '@strlngco/fallback-shopify';

export const RESTORE_RESOURCE_KEYS = ['products', 'metafields', 'metaobjects'] as const;

export const RESTORE_PLAN_CONFIG: RestorePlanConfig = {
  resources: {
    products: {
      supportedPaths: [...PRODUCT_SUPPORTED_PATHS, ...VARIANT_SUPPORTED_PATHS],
      getId: (record) => String((record as { id?: unknown }).id ?? ''),
    },
    metafields: {
      supportedPaths: [...METAFIELD_SUPPORTED_PATHS],
      getId: (record) => metafieldKey(record as Metafield),
      recordSupport: (record) =>
        reservedContentReason(String((record as { namespace?: unknown }).namespace ?? '')),
    },
    metaobjects: {
      supportedPaths: [...METAOBJECT_SUPPORTED_PATHS],
      getId: (record) => String((record as { id?: unknown }).id ?? ''),
      recordSupport: (record) =>
        reservedContentReason(String((record as { type?: unknown }).type ?? '')),
    },
    // Definitions are diffed for visibility but never written (spec: settled
    // decision 1). Listing them here routes their drift to skipped.unsupported
    // instead of silently dropping the resource from the plan.
    metafieldDefinitions: {
      supportedPaths: [],
      getId: (record) => metafieldDefinitionKey(record as MetafieldDefinition),
      recordSupport: () => 'definitions are not restorable',
    },
    metaobjectDefinitions: {
      supportedPaths: [],
      getId: (record) => String((record as { type?: unknown }).type ?? ''),
      recordSupport: () => 'definitions are not restorable',
    },
  },
};
