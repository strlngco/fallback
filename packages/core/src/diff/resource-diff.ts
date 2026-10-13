import { computeFieldChanges } from './field-changes';
import type { FieldChangesConfig, ResourceDiff, UpdatedRecord } from './types';

export interface DiffResourcesOptions<T> {
  snapshot: AsyncIterable<T> | Iterable<T>;
  current: AsyncIterable<T> | Iterable<T>;
  getId: (record: T) => string;
  fieldChangesConfig?: FieldChangesConfig;
}

export async function diffResources<T>(
  options: DiffResourcesOptions<T>,
): Promise<ResourceDiff<T>> {
  const snapshotById = new Map<string, T>();
  let snapshotCount = 0;
  for await (const record of options.snapshot) {
    snapshotById.set(options.getId(record), record);
    snapshotCount++;
  }

  const created: T[] = [];
  const updated: UpdatedRecord<T>[] = [];
  const seen = new Set<string>();
  let unchanged = 0;
  let currentCount = 0;
  let ignoredCount = 0;

  for await (const record of options.current) {
    currentCount++;
    const id = options.getId(record);
    seen.add(id);
    const before = snapshotById.get(id);
    if (before === undefined) {
      created.push(record);
      continue;
    }
    const result = computeFieldChanges(before, record, options.fieldChangesConfig);
    ignoredCount += result.ignoredCount;
    if (result.changes.length === 0) {
      unchanged++;
    } else {
      updated.push({
        id,
        before,
        after: record,
        changes: result.changes,
        ignoredCount: result.ignoredCount,
      });
    }
  }

  const deleted: T[] = [];
  for (const [id, record] of snapshotById) {
    if (!seen.has(id)) deleted.push(record);
  }

  return {
    created,
    updated,
    deleted,
    unchanged,
    snapshotCount,
    currentCount,
    ignoredCount,
  };
}
