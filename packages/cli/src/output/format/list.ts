import pc from 'picocolors';
import type { Manifest, ManifestCounts, ManifestScope } from '@strlngco/fallback-core';

export interface ListEntryView {
  shop: string;
  snapshotId: string;
  snapshotDir: string;
  manifest: Manifest | null;
  brokenReason: string | undefined;
  directorySize: number;
}

const COLUMN_GAP = '  ';

interface Row {
  id: string;
  captured: string;
  scope: string;
  counts: string;
  size: string;
}

export function formatListHuman(snapshots: ListEntryView[], now: Date): string[] {
  const grouped = groupByShop(snapshots);
  const lines: string[] = [];
  let first = true;
  for (const [shop, list] of grouped) {
    if (!first) lines.push('');
    first = false;
    lines.push(shop);
    lines.push(...shopTableLines(list, now));
  }
  return lines;
}

function shopTableLines(snapshots: ListEntryView[], now: Date): string[] {
  const rows: Row[] = snapshots.map((s) => {
    if (s.manifest === null) {
      return {
        id: s.snapshotId,
        captured: `(broken: ${s.brokenReason ?? 'unknown'})`,
        scope: '-',
        counts: '-',
        size: '-',
      };
    }
    return {
      id: s.snapshotId,
      captured: relativeTime(new Date(s.manifest.capturedAt), now),
      scope: compactScope(s.manifest.scope),
      counts: compactCounts(s.manifest.counts),
      size: formatSize(s.directorySize),
    };
  });

  const headers: Row = {
    id: 'SNAPSHOT ID',
    captured: 'CAPTURED',
    scope: 'SCOPE',
    counts: 'COUNTS',
    size: 'SIZE',
  };

  const widths = {
    id: maxLength(headers.id, rows, (r) => r.id),
    captured: maxLength(headers.captured, rows, (r) => r.captured),
    scope: maxLength(headers.scope, rows, (r) => r.scope),
    counts: maxLength(headers.counts, rows, (r) => r.counts),
    size: maxLength(headers.size, rows, (r) => r.size),
  };

  const formatRow = (r: Row): string =>
    [
      r.id.padEnd(widths.id),
      r.captured.padEnd(widths.captured),
      r.scope.padEnd(widths.scope),
      r.counts.padEnd(widths.counts),
      r.size.padEnd(widths.size),
    ].join(COLUMN_GAP);

  return [pc.dim(formatRow(headers)), ...rows.map(formatRow)];
}

function maxLength(headerText: string, rows: Row[], pick: (r: Row) => string): number {
  let max = headerText.length;
  for (const row of rows) {
    const v = pick(row).length;
    if (v > max) max = v;
  }
  return max;
}

function groupByShop(snapshots: ListEntryView[]): Map<string, ListEntryView[]> {
  const groups = new Map<string, ListEntryView[]>();
  for (const s of snapshots) {
    const arr = groups.get(s.shop) ?? [];
    arr.push(s);
    groups.set(s.shop, arr);
  }
  return groups;
}

function compactScope(scope: ManifestScope): string {
  const parts: string[] = [];
  if (scope.products) parts.push('p');
  if (scope.collections) parts.push('c');
  if (scope.metafields) parts.push('m');
  if (scope.metaobjects === true) parts.push('o');
  if (scope.inventoryLevels) parts.push('i');
  return parts.join(',') || '-';
}

function compactCounts(counts: ManifestCounts): string {
  const base = `${counts.products}p / ${counts.variants}v / ${counts.collections}c / ${counts.metafields}m / ${counts.inventoryLevels}i`;
  // Absent on pre-content manifests — appending only when present keeps old rows identical.
  return counts.metaobjects === undefined ? base : `${base} / ${counts.metaobjects}o`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function relativeTime(captured: Date, now: Date): string {
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const diffSeconds = Math.round((captured.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diffSeconds);
  if (abs < 60) return rtf.format(diffSeconds, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSeconds / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSeconds / 3600), 'hour');
  if (abs < 86400 * 7) return rtf.format(Math.round(diffSeconds / 86400), 'day');
  if (abs < 86400 * 30) return rtf.format(Math.round(diffSeconds / 86400 / 7), 'week');
  if (abs < 86400 * 365) return rtf.format(Math.round(diffSeconds / 86400 / 30), 'month');
  return rtf.format(Math.round(diffSeconds / 86400 / 365), 'year');
}
