import { pathMatchesIgnorePattern } from '../diff/field-changes';
import type { ResourceDiff, SnapshotDiff, UpdatedRecord } from '../diff/types';
import type {
  RestoreOperation,
  RestorePlan,
  RestorePlanConfig,
  RestoreResourceConfig,
  RestoreSkip,
} from './types';

export interface BuildRestorePlanInput {
  snapshotId: string;
  shop: string;
  builtAt: string;
  diff: SnapshotDiff;
  config: RestorePlanConfig;
}

export function buildRestorePlan(input: BuildRestorePlanInput): RestorePlan {
  const operations: RestoreOperation[] = [];
  const created: RestoreSkip[] = [];
  const deleted: RestoreSkip[] = [];
  const unsupported: RestoreSkip[] = [];

  for (const [resource, cfg] of Object.entries(input.config.resources)) {
    const resourceDiff = input.diff.resources[resource] as ResourceDiff<unknown> | undefined;
    if (resourceDiff === undefined) continue;

    for (const record of resourceDiff.created) {
      created.push({
        resource,
        id: cfg.getId(record),
        reason: 'created since snapshot; restore does not recreate',
      });
    }
    for (const record of resourceDiff.deleted) {
      deleted.push({
        resource,
        id: cfg.getId(record),
        reason: 'deleted since snapshot; restore does not delete',
      });
    }
    for (const updated of resourceDiff.updated) {
      const supportReason = cfg.recordSupport?.(updated.before) ?? null;
      if (supportReason !== null) {
        unsupported.push({ resource, id: updated.id, reason: supportReason });
        continue;
      }
      const op = planUpdatedRecord(resource, cfg, updated);
      if (op !== null) {
        operations.push(op);
      } else {
        unsupported.push({ resource, id: updated.id, reason: 'no restorable fields changed' });
      }
    }
  }

  return {
    snapshotId: input.snapshotId,
    shop: input.shop,
    builtAt: input.builtAt,
    operations,
    skipped: { created, deleted, unsupported },
  };
}

function planUpdatedRecord(
  resource: string,
  cfg: RestoreResourceConfig,
  updated: UpdatedRecord<unknown>,
): RestoreOperation | null {
  const supportedChanges = updated.changes.filter((change) =>
    cfg.supportedPaths.some((pattern) => pathMatchesIgnorePattern(change.path, pattern)),
  );
  if (supportedChanges.length === 0) return null;
  // A diff reads snapshot → current; a restore moves the other way, so each
  // change is inverted to show what the write does: current value → snapshot value.
  return {
    resource,
    id: updated.id,
    changes: supportedChanges.map((change) => ({
      path: change.path,
      before: change.after,
      after: change.before,
    })),
    targetRecord: updated.before,
  };
}
