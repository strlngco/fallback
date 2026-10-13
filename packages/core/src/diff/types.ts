import { z } from 'zod';

export const FieldChangeSchema = z.object({
  path: z.string(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
});

export type FieldChange = z.infer<typeof FieldChangeSchema>;

export const UpdatedRecordSchema = z.object({
  id: z.string(),
  before: z.unknown(),
  after: z.unknown(),
  changes: z.array(FieldChangeSchema),
  ignoredCount: z.number().int().nonnegative(),
});

export interface UpdatedRecord<T> {
  id: string;
  before: T;
  after: T;
  changes: FieldChange[];
  ignoredCount: number;
}

export const ResourceDiffSchema = z.object({
  created: z.array(z.unknown()),
  updated: z.array(UpdatedRecordSchema),
  deleted: z.array(z.unknown()),
  unchanged: z.number().int().nonnegative(),
  snapshotCount: z.number().int().nonnegative(),
  currentCount: z.number().int().nonnegative(),
  ignoredCount: z.number().int().nonnegative(),
});

export interface ResourceDiff<T> {
  created: T[];
  updated: UpdatedRecord<T>[];
  deleted: T[];
  unchanged: number;
  snapshotCount: number;
  currentCount: number;
  ignoredCount: number;
}

export const SnapshotDiffSchema = z.object({
  snapshotId: z.string(),
  shop: z.string(),
  computedAt: z.string().datetime({ offset: true }),
  resources: z.record(z.string(), ResourceDiffSchema),
});

export interface SnapshotDiff {
  snapshotId: string;
  shop: string;
  computedAt: string;
  resources: Record<string, ResourceDiff<unknown>>;
}

export interface FieldChangesConfig {
  keyedArrays?: Record<string, (item: unknown) => string>;
  ignorePaths?: string[];
}
