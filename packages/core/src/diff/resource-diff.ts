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

  // Sorted so the same changes always print in the same order, whatever order
  // the API returned records in.
  created.sort((a, b) => compareIds(options.getId(a), options.getId(b)));
  updated.sort((a, b) => compareIds(a.id, b.id));
  deleted.sort((a, b) => compareIds(options.getId(a), options.getId(b)));

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

// Digit runs compare as numbers, so gid://shopify/Product/9 sorts before
// gid://shopify/Product/10. Locale-independent, so every machine agrees.
export function compareIds(a: string, b: string): number {
  const partsA = a.match(/\d+|\D+/g) ?? [];
  const partsB = b.match(/\d+|\D+/g) ?? [];
  const length = Math.min(partsA.length, partsB.length);
  for (let i = 0; i < length; i++) {
    const x = partsA[i] as string;
    const y = partsB[i] as string;
    if (x === y) continue;
    const bothDigits = /^\d/.test(x) && /^\d/.test(y);
    if (bothDigits) {
      const nx = x.replace(/^0+(?=\d)/, '');
      const ny = y.replace(/^0+(?=\d)/, '');
      if (nx.length !== ny.length) return nx.length - ny.length;
    }
    return x < y ? -1 : 1;
  }
  return partsA.length - partsB.length;
}
