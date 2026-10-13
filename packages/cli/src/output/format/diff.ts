import pc from 'picocolors';

import type { FieldChange, ResourceDiff, SnapshotDiff } from '@strlngco/fallback-core';
import type { Metafield } from '@strlngco/fallback-shopify';

interface ResourceSection {
  key:
    | 'products'
    | 'collections'
    | 'metafields'
    | 'inventoryLevels'
    | 'metaobjects'
    | 'metaobjectDefinitions'
    | 'metafieldDefinitions';
  label: string;
}

const SECTIONS: readonly ResourceSection[] = [
  { key: 'products', label: 'Products' },
  { key: 'collections', label: 'Collections' },
  { key: 'metafields', label: 'Metafields' },
  { key: 'inventoryLevels', label: 'InventoryLevels' },
  { key: 'metaobjects', label: 'Metaobjects' },
  { key: 'metaobjectDefinitions', label: 'MetaobjectDefinitions' },
  { key: 'metafieldDefinitions', label: 'MetafieldDefinitions' },
];

const MAX_VALUE_PREVIEW = 60;
const MAX_INLINE_CHANGES = 3;

export function formatDiffSummary(diff: SnapshotDiff): string[] {
  const lines: string[] = [];
  for (const section of SECTIONS) {
    const r = diff.resources[section.key] as ResourceDiff<unknown> | undefined;
    if (r === undefined) continue;
    lines.push(
      `${section.label}: +${r.created.length} / ~${r.updated.length} / -${r.deleted.length} ` +
        `(${r.snapshotCount} in snapshot, ${r.currentCount} in current)`,
    );
  }
  return lines;
}

export function formatDiffHuman(diff: SnapshotDiff, opts: { showIgnored: boolean }): string[] {
  const lines: string[] = [];
  let first = true;
  for (const section of SECTIONS) {
    const r = diff.resources[section.key] as ResourceDiff<unknown> | undefined;
    if (r === undefined) continue;
    if (!first) lines.push('');
    first = false;
    lines.push(section.label);

    if (r.created.length === 0 && r.updated.length === 0 && r.deleted.length === 0) {
      lines.push(`  No changes (${r.snapshotCount} in snapshot, ${r.currentCount} in current)`);
      pushIgnored(lines, r.ignoredCount, opts.showIgnored);
      continue;
    }

    lines.push(`  Created: ${r.created.length}`);
    for (const item of r.created) {
      lines.push(`    ${pc.green('+')} ${displayName(section.key, item)} (${displayId(section.key, item)})`);
    }

    lines.push(`  Updated: ${r.updated.length}`);
    for (const u of r.updated) {
      lines.push(`    ${pc.yellow('~')} ${displayName(section.key, u.after)} (${displayId(section.key, u.after)})`);
      if (opts.showIgnored || u.changes.length <= MAX_INLINE_CHANGES) {
        for (const change of u.changes) {
          lines.push(`        ${pc.dim(formatChange(change))}`);
        }
      } else {
        lines.push(`        ${pc.dim(`${u.changes.length} field changes — use --json for details`)}`);
      }
    }

    lines.push(`  Deleted: ${r.deleted.length}`);
    for (const item of r.deleted) {
      lines.push(`    ${pc.red('-')} ${displayName(section.key, item)} (${displayId(section.key, item)})`);
    }

    pushIgnored(lines, r.ignoredCount, opts.showIgnored);
  }
  return lines;
}

function pushIgnored(lines: string[], ignoredCount: number, showIgnored: boolean): void {
  if (showIgnored) return;
  if (ignoredCount <= 0) return;
  lines.push(`  ${pc.dim(`${ignoredCount} ignored changes (use --show-ignored to view)`)}`);
}

function displayName(key: ResourceSection['key'], item: unknown): string {
  const o = item as Record<string, unknown>;
  if (key === 'products') return String(o['title'] ?? '<unnamed>');
  if (key === 'collections') return String(o['title'] ?? '<unnamed>');
  if (key === 'metafields') return `${String(o['namespace'] ?? '')}.${String(o['key'] ?? '')}`;
  if (key === 'metaobjects') return `${String(o['type'] ?? '?')}/${String(o['handle'] ?? '?')}`;
  if (key === 'metaobjectDefinitions') return String(o['type'] ?? '<untyped>');
  if (key === 'metafieldDefinitions') {
    return `${String(o['ownerType'] ?? '?')}.${String(o['namespace'] ?? '')}.${String(o['key'] ?? '')}`;
  }
  const loc = o['location'] as Record<string, unknown> | undefined;
  const itm = o['item'] as Record<string, unknown> | undefined;
  return `${String(loc?.['name'] ?? '?')} / ${String(itm?.['id'] ?? '?')}`;
}

function displayId(key: ResourceSection['key'], item: unknown): string {
  const o = item as Record<string, unknown>;
  if (key === 'metafields') return String(o['id'] ?? metafieldKey(item as Metafield));
  return String(o['id'] ?? '?');
}

function metafieldKey(m: Metafield): string {
  return `${m.ownerId}::${m.namespace}::${m.key}`;
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
