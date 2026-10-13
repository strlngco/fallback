import { z } from 'zod';

export const ManifestScopeSchema = z.object({
  products: z.boolean(),
  collections: z.boolean(),
  metafields: z.boolean(),
  inventoryLevels: z.boolean(),
  // Content fields are optional, never defaulted: a defaulted key would be injected into
  // parsed pre-content manifests and change list --json byte output for old snapshots.
  metaobjects: z.boolean().optional(),
  metafieldOwnerTypes: z.array(z.string()).optional(),
  themes: z.literal(false),
  customers: z.literal(false),
  orders: z.literal(false),
  discounts: z.literal(false),
});

export const ManifestCountsSchema = z.object({
  products: z.number().int().nonnegative(),
  variants: z.number().int().nonnegative(),
  collections: z.number().int().nonnegative(),
  metafields: z.number().int().nonnegative(),
  inventoryLevels: z.number().int().nonnegative(),
  metaobjects: z.number().int().nonnegative().optional(),
  metaobjectDefinitions: z.number().int().nonnegative().optional(),
  metafieldDefinitions: z.number().int().nonnegative().optional(),
});

export const SNAPSHOT_ID_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/;

export const ManifestSchema = z.object({
  version: z.literal(1),
  shop: z.string().min(1),
  capturedAt: z.string().datetime({ offset: true }),
  apiVersion: z.string().min(1),
  fallbackVersion: z.string().min(1),
  scope: ManifestScopeSchema,
  counts: ManifestCountsSchema,
  durationMs: z.number().int().nonnegative(),
  snapshotId: z
    .string()
    .regex(
      SNAPSHOT_ID_PATTERN,
      'Expected snapshotId in basic ISO 8601 format (e.g. 2026-05-06T14-30-22Z)',
    ),
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type ManifestScope = z.infer<typeof ManifestScopeSchema>;
export type ManifestCounts = z.infer<typeof ManifestCountsSchema>;

// Pre-content manifests captured metafields for product owners only, so absent
// coverage means ['PRODUCT']. This is a Fallback manifest-format semantic, not
// Shopify knowledge: the strings are opaque to core.
export function manifestMetafieldOwnerTypes(scope: ManifestScope): string[] {
  if (!scope.metafields) return [];
  return scope.metafieldOwnerTypes ?? ['PRODUCT'];
}
