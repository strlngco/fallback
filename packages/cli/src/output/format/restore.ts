import pc from 'picocolors';
import type { FieldChange, RestorePlan, RestoreResult } from '@strlngco/fallback-core';

const MAX_VALUE_PREVIEW = 60;
const MAX_INLINE_CHANGES = 3;

export function formatRestorePlan(plan: RestorePlan): string[] {
  const lines: string[] = [];
  lines.push('Dry run — no changes written. Re-run with --apply to write.');
  lines.push('');
  lines.push(`To write: ${plan.operations.length}`);
  for (const op of plan.operations) {
    lines.push(`  ${pc.yellow('~')} ${op.id} (${op.resource})`);
    if (op.changes.length <= MAX_INLINE_CHANGES) {
      for (const change of op.changes) lines.push(`      ${pc.dim(formatChange(change))}`);
    } else {
      lines.push(`      ${pc.dim(`${op.changes.length} field changes — use --json for details`)}`);
    }
  }
  lines.push(`Skipped (created): ${plan.skipped.created.length}`);
  lines.push(`Skipped (deleted): ${plan.skipped.deleted.length}`);
  lines.push(`Skipped (unsupported): ${plan.skipped.unsupported.length}`);
  return lines;
}

export function formatRestorePlanSummary(plan: RestorePlan): string[] {
  const skipped =
    plan.skipped.created.length + plan.skipped.deleted.length + plan.skipped.unsupported.length;
  return [`Restore plan: ${plan.operations.length} to write, ${skipped} skipped`];
}

export function formatRestoreResult(result: RestoreResult): string[] {
  const lines: string[] = [];
  lines.push(
    `Restored ${result.counts.restored}, failed ${result.counts.failed}, skipped ${result.counts.skipped}`,
  );
  const failures = result.results.filter((r) => r.status === 'failed');
  if (failures.length > 0) {
    lines.push('Failed:');
    for (const f of failures) lines.push(`  ${f.id}: ${f.error ?? 'unknown error'}`);
  }
  return lines;
}

function formatChange(change: FieldChange): string {
  return `${change.path}: ${formatValue(change.before)} → ${formatValue(change.after)}`;
}

function formatValue(v: unknown): string {
  if (v === undefined) return 'undefined';
  const s = JSON.stringify(v);
  if (s === undefined) return 'undefined';
  if (s.length > MAX_VALUE_PREVIEW) return s.slice(0, MAX_VALUE_PREVIEW - 3) + '...';
  return s;
}
