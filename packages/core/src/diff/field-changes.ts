import type { FieldChange, FieldChangesConfig } from './types';

const EMPTY_CONFIG: FieldChangesConfig = {};

export interface FieldChangesResult {
  changes: FieldChange[];
  ignoredCount: number;
}

interface WalkOutput {
  changes: FieldChange[];
  ignoredCount: number;
}

export function computeFieldChanges(
  before: unknown,
  after: unknown,
  config: FieldChangesConfig = EMPTY_CONFIG,
): FieldChangesResult {
  const out: WalkOutput = { changes: [], ignoredCount: 0 };
  walk(before, after, '', out, config);
  return { changes: out.changes, ignoredCount: out.ignoredCount };
}

function walk(
  before: unknown,
  after: unknown,
  path: string,
  out: WalkOutput,
  config: FieldChangesConfig,
): void {
  if (deepEqual(before, after)) return;

  if (!isObject(before) || !isObject(after)) {
    emitIfNotIgnored(path, before, after, out, config);
    return;
  }

  if (Array.isArray(before) !== Array.isArray(after)) {
    emitIfNotIgnored(path, before, after, out, config);
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const getId = config.keyedArrays?.[path];
    if (getId !== undefined) {
      walkKeyedArray(before, after, getId, path, out, config);
    } else {
      walkIndexedArray(before, after, path, out, config);
    }
    return;
  }

  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const inA = Object.prototype.hasOwnProperty.call(a, key);
    const inB = Object.prototype.hasOwnProperty.call(b, key);
    const childPath = appendPath(path, key);
    if (!inA) {
      emitIfNotIgnored(childPath, undefined, b[key], out, config);
    } else if (!inB) {
      emitIfNotIgnored(childPath, a[key], undefined, out, config);
    } else {
      walk(a[key], b[key], childPath, out, config);
    }
  }
}

function walkIndexedArray(
  before: unknown[],
  after: unknown[],
  path: string,
  out: WalkOutput,
  config: FieldChangesConfig,
): void {
  if (before.length !== after.length) {
    emitIfNotIgnored(appendPath(path, 'length'), before.length, after.length, out, config);
  }
  const max = Math.max(before.length, after.length);
  for (let i = 0; i < max; i++) {
    const childPath = appendPath(path, i);
    if (i >= before.length) {
      emitIfNotIgnored(childPath, undefined, after[i], out, config);
    } else if (i >= after.length) {
      emitIfNotIgnored(childPath, before[i], undefined, out, config);
    } else {
      walk(before[i], after[i], childPath, out, config);
    }
  }
}

function walkKeyedArray(
  before: unknown[],
  after: unknown[],
  getId: (item: unknown) => string,
  path: string,
  out: WalkOutput,
  config: FieldChangesConfig,
): void {
  const beforeById = new Map<string, unknown>();
  for (const item of before) beforeById.set(getId(item), item);
  const afterById = new Map<string, unknown>();
  for (const item of after) afterById.set(getId(item), item);

  for (const [id, item] of beforeById) {
    if (!afterById.has(id)) {
      emitIfNotIgnored(appendKeyedPath(path, id), item, undefined, out, config);
    }
  }
  for (const [id, item] of afterById) {
    const childPath = appendKeyedPath(path, id);
    if (!beforeById.has(id)) {
      emitIfNotIgnored(childPath, undefined, item, out, config);
    } else {
      walk(beforeById.get(id), item, childPath, out, config);
    }
  }
}

function emitIfNotIgnored(
  path: string,
  before: unknown,
  after: unknown,
  out: WalkOutput,
  config: FieldChangesConfig,
): void {
  if (isIgnored(path, config)) {
    out.ignoredCount++;
    return;
  }
  out.changes.push(emitChange(path, before, after));
}

function emitChange(path: string, before: unknown, after: unknown): FieldChange {
  const change: FieldChange = { path: path === '' ? '<root>' : path };
  if (before !== undefined) change.before = before;
  if (after !== undefined) change.after = after;
  return change;
}

function isIgnored(path: string, config: FieldChangesConfig): boolean {
  const patterns = config.ignorePaths;
  if (patterns === undefined || patterns.length === 0) return false;
  for (const pattern of patterns) {
    if (pathMatchesIgnorePattern(path, pattern)) return true;
  }
  return false;
}

// Matches when the path is the pattern, or a sub-path under it. Bracketed
// identity segments in `path` are normalized to `[*]` before comparison so
// patterns like `variants[*].updatedAt` cover all keyed-array element paths.
export function pathMatchesIgnorePattern(path: string, pattern: string): boolean {
  const normalized = normalizeBracketSegments(path);
  if (normalized === pattern) return true;
  return (
    normalized.startsWith(`${pattern}.`) || normalized.startsWith(`${pattern}[`)
  );
}

function normalizeBracketSegments(path: string): string {
  return path.replace(/\[[^\]]+\]/g, '[*]');
}

function appendPath(prefix: string, segment: string | number): string {
  if (prefix === '') return String(segment);
  return `${prefix}.${segment}`;
}

function appendKeyedPath(prefix: string, identity: string): string {
  return `${prefix}[${identity}]`;
}

function isObject(v: unknown): v is object {
  return v !== null && typeof v === 'object';
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao);
  const bKeys = Object.keys(bo);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}
