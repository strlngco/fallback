import type { ScopeFlags, SnapshotResult } from '../../snapshot/writer';

export interface SnapshotSummaryView extends SnapshotResult {
  shop: string;
  scope: ScopeFlags;
}

export function formatSnapshotSummary(summary: SnapshotSummaryView): string[] {
  const c = summary.counts;
  const lines = [
    `Captured ${c.products} products (${c.variants} variants), ${c.collections} collections, ${c.metafields} metafields, ${c.inventoryLevels} inventory levels.`,
  ];
  const contentParts: string[] = [];
  if (summary.scope.metaobjects) {
    contentParts.push(`${c.metaobjects ?? 0} metaobjects (${c.metaobjectDefinitions ?? 0} definitions)`);
  }
  if (summary.scope.metafields) {
    contentParts.push(`${c.metafieldDefinitions ?? 0} metafield definitions`);
  }
  if (contentParts.length > 0) lines.push(`Captured ${contentParts.join(', ')}.`);
  lines.push(
    `Snapshot ID: ${summary.snapshotId}`,
    `Snapshot directory: ${summary.snapshotDir}`,
    `Duration: ${(summary.durationMs / 1000).toFixed(1)}s`,
  );
  return lines;
}
