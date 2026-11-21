import type { FieldChange } from '@strlngco/fallback-core';

// Field-change lines shared by `diff` and `restore` human output. JSON output
// never goes through here and keeps the raw paths.

const MAX_VALUE_PREVIEW = 60;

export function formatChange(change: FieldChange, variantTitles?: Map<string, string>): string {
  const readable = variantTitles === undefined ? undefined : formatVariantChange(change, variantTitles);
  return readable ?? `${change.path}: ${formatValue(change.before)} → ${formatValue(change.after)}`;
}

// Single-variant products carry one variant titled "Default Title"; naming it
// adds nothing, so its changes print as plain product fields.
const DEFAULT_VARIANT_TITLE = 'Default Title';
const VARIANT_PATH = /^variants\[([^\]]+)\](?:\.(.+))?$/;

export function collectVariantTitles(...records: unknown[]): Map<string, string> {
  const titles = new Map<string, string>();
  for (const record of records) {
    const variants = (record as Record<string, unknown> | undefined)?.['variants'];
    if (!Array.isArray(variants)) continue;
    for (const v of variants as Array<Record<string, unknown>>) {
      if (typeof v['id'] === 'string' && typeof v['title'] === 'string') titles.set(v['id'], v['title']);
    }
  }
  // A title shared by two variants would name the wrong one; leave both on
  // their GID path.
  const idsByTitle = new Map<string, number>();
  for (const title of titles.values()) idsByTitle.set(title, (idsByTitle.get(title) ?? 0) + 1);
  for (const [id, title] of titles) if (idsByTitle.get(title)! > 1) titles.delete(id);
  return titles;
}

// Human output only: `variants[<gid>].price.amount` becomes `Ice / price`.
// JSON output keeps the full path. Returns undefined to fall back to the raw
// path when the variant cannot be named.
function formatVariantChange(change: FieldChange, titles: Map<string, string>): string | undefined {
  const match = VARIANT_PATH.exec(change.path);
  if (match === null) return undefined;
  const title = titles.get(match[1]!);
  if (title === undefined) return undefined;
  const field = match[2];
  const label = title === DEFAULT_VARIANT_TITLE ? '' : title;

  if (field === undefined) {
    const event =
      change.before === undefined ? 'variant added' : change.after === undefined ? 'variant removed' : 'variant changed';
    return `${label || 'variant'}: ${event}`;
  }

  const isMoney = field.endsWith('.amount') && isMoneyValue(change.before) && isMoneyValue(change.after);
  const name = isMoney ? field.slice(0, -'.amount'.length) : field;
  const show = isMoney ? (v: unknown) => (v === undefined ? 'none' : String(v)) : formatValue;
  const prefix = label === '' ? name : `${label} / ${name}`;
  return `${prefix}: ${show(change.before)} → ${show(change.after)}`;
}

function isMoneyValue(v: unknown): boolean {
  return v === undefined || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v));
}

function formatValue(v: unknown): string {
  if (v === undefined) return 'undefined';
  const s = JSON.stringify(v);
  if (s === undefined) return 'undefined';
  if (s.length > MAX_VALUE_PREVIEW) return s.slice(0, MAX_VALUE_PREVIEW - 3) + '...';
  return s;
}
