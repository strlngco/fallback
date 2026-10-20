import { z } from 'zod';
import { FieldChangeSchema, type FieldChange } from '../diff/types';

export const RestoreOperationSchema = z.object({
  resource: z.string(),
  id: z.string(),
  changes: z.array(FieldChangeSchema),
  targetRecord: z.unknown(),
});

export interface RestoreOperation {
  resource: string;
  id: string;
  changes: FieldChange[];
  targetRecord: unknown;
}

export const RestoreSkipSchema = z.object({
  resource: z.string(),
  id: z.string(),
  reason: z.string(),
});

export type RestoreSkip = z.infer<typeof RestoreSkipSchema>;

export const RestoreSkippedSchema = z.object({
  created: z.array(RestoreSkipSchema),
  deleted: z.array(RestoreSkipSchema),
  unsupported: z.array(RestoreSkipSchema),
});

export type RestoreSkipped = z.infer<typeof RestoreSkippedSchema>;

export const RestorePlanSchema = z.object({
  snapshotId: z.string(),
  shop: z.string(),
  builtAt: z.string().datetime({ offset: true }),
  operations: z.array(RestoreOperationSchema),
  skipped: RestoreSkippedSchema,
});

export interface RestorePlan {
  snapshotId: string;
  shop: string;
  builtAt: string;
  operations: RestoreOperation[];
  skipped: RestoreSkipped;
}

export const RestoreOperationResultSchema = z.object({
  resource: z.string(),
  id: z.string(),
  status: z.enum(['restored', 'failed']),
  error: z.string().optional(),
  // On a failed operation, the parts that were written before the failure.
  written: z.array(z.string()).optional(),
});

export type RestoreOperationResult = z.infer<typeof RestoreOperationResultSchema>;

export const RestoreResultSchema = z.object({
  snapshotId: z.string(),
  shop: z.string(),
  appliedAt: z.string().datetime({ offset: true }),
  results: z.array(RestoreOperationResultSchema),
  skipped: RestoreSkippedSchema,
  counts: z.object({
    restored: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
});

export type RestoreResult = z.infer<typeof RestoreResultSchema>;

export interface RestoreResourceConfig {
  supportedPaths: string[];
  getId: (record: unknown) => string;
  recordSupport?: (record: unknown) => string | null;
}

export interface RestorePlanConfig {
  resources: Record<string, RestoreResourceConfig>;
}
