import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Command, Option } from 'clipanion';

import {
  ManifestSchema,
  type Manifest,
} from '@strlngco/fallback-core';
import { assertShopDomain } from '@strlngco/fallback-shopify';

import { InvalidOptionError } from '../env';
import { defaultBaseDir, isENOENT } from '../output/paths';
import { OutputWriter } from '../output/writer';
import { formatListHuman, type ListEntryView } from '../output/format/list';
import type { SnapshotContext } from './snapshot';

interface DiscoveredSnapshot {
  shop: string;
  snapshotId: string;
  snapshotDir: string;
  manifest: Manifest | null;
  partialManifest?: unknown;
  brokenReason: string | undefined;
  directorySize: number;
}

function toListEntryView(s: DiscoveredSnapshot): ListEntryView {
  return {
    shop: s.shop,
    snapshotId: s.snapshotId,
    snapshotDir: s.snapshotDir,
    manifest: s.manifest,
    brokenReason: s.brokenReason,
    directorySize: s.directorySize,
  };
}

export class ListCommand extends Command<SnapshotContext> {
  static override paths = [['list']];

  static override usage = Command.Usage({
    description: 'List local snapshots.',
    details: `
      Walks the snapshot base directory and prints a summary of every snapshot found.
      Snapshots are grouped by shop and sorted newest-first. Broken or unreadable
      snapshots are surfaced with a marker rather than hidden.
    `,
    examples: [
      ['List every snapshot', 'fallback list'],
      ['List only one shop', 'fallback list --shop example.myshopify.com'],
      ['Show the 5 most recent snapshots per shop', 'fallback list --limit 5'],
      ['Emit as JSON for scripting', 'fallback list --json'],
    ],
  });

  shop = Option.String('--shop', {
    description: 'List snapshots only for this shop domain',
  });
  baseDir = Option.String('--base-dir', {
    description: 'Override the snapshot base directory (default ~/.fallback/snapshots)',
  });
  json = Option.Boolean('--json', false, {
    description: 'Emit the list as JSON to stdout',
  });
  limit = Option.String('--limit', {
    description: 'Show only the most recent N snapshots per shop',
  });

  override async execute(): Promise<number> {
    const writer = new OutputWriter({
      stdout: this.context.stdout,
      stderr: this.context.stderr,
      json: this.json,
    });
    try {
      return await this.run(writer);
    } catch (err) {
      return writer.error(err);
    }
  }

  private async run(writer: OutputWriter): Promise<number> {
    const baseDir = this.baseDir ?? defaultBaseDir(this.context.deps.homeDir());
    const limit = this.parseLimit();
    if (this.shop !== undefined) assertShopDomain(this.shop);
    const discovered = await discoverSnapshots(baseDir, this.shop);

    if (discovered.length === 0) {
      if (this.json) writer.json([]);
      else this.context.stderr.write(`No snapshots found in ${baseDir}\n`);
      return 0;
    }

    const limited = applyLimit(sortSnapshots(discovered), limit);

    if (this.json) {
      writer.json(this.toJsonShape(limited));
    } else {
      const now = this.context.deps.now();
      writer.human(formatListHuman(limited.map(toListEntryView), now));
    }
    return 0;
  }

  private parseLimit(): number | null {
    if (this.limit === undefined) return null;
    const trimmed = this.limit.trim();
    if (!/^[0-9]+$/.test(trimmed)) {
      throw new InvalidOptionError(`--limit must be a positive integer (got: "${this.limit}").`);
    }
    const n = Number.parseInt(trimmed, 10);
    if (n < 1) {
      throw new InvalidOptionError(`--limit must be a positive integer (got: "${this.limit}").`);
    }
    return n;
  }

  // Locked machine contract — shape must not change without a breaking-change
  // version bump. toJsonShape is verbatim-identical to the former printJson mapping.
  private toJsonShape(snapshots: DiscoveredSnapshot[]): unknown[] {
    return snapshots.map((s) => {
      if (s.manifest === null) {
        return {
          broken: true,
          brokenReason: s.brokenReason ?? 'unknown',
          shop: s.shop,
          snapshotId: s.snapshotId,
          directoryPath: s.snapshotDir,
          directorySize: s.directorySize,
          ...(s.partialManifest !== undefined ? { partialManifest: s.partialManifest } : {}),
        };
      }
      return {
        ...s.manifest,
        directoryPath: s.snapshotDir,
        directorySize: s.directorySize,
      };
    });
  }
}

async function discoverSnapshots(
  baseDir: string,
  shopFilter: string | undefined,
): Promise<DiscoveredSnapshot[]> {
  const result: DiscoveredSnapshot[] = [];
  let shopEntries: string[];
  try {
    shopEntries = await readdir(baseDir);
  } catch (err) {
    if (isENOENT(err)) return [];
    throw err;
  }
  for (const shop of shopEntries) {
    if (shopFilter !== undefined && shop !== shopFilter) continue;
    const shopPath = join(baseDir, shop);
    const shopStats = await safeStat(shopPath);
    if (!shopStats || !shopStats.isDirectory()) continue;
    const snapshotEntries = await safeReaddir(shopPath);
    for (const snapshotId of snapshotEntries) {
      const snapshotPath = join(shopPath, snapshotId);
      const snapshotStats = await safeStat(snapshotPath);
      if (!snapshotStats || !snapshotStats.isDirectory()) continue;
      result.push(await loadSnapshot(shop, snapshotId, snapshotPath));
    }
  }
  return result;
}

async function loadSnapshot(
  shop: string,
  snapshotId: string,
  snapshotDir: string,
): Promise<DiscoveredSnapshot> {
  const manifestPath = join(snapshotDir, 'manifest.json');
  let manifest: Manifest | null = null;
  let partialManifest: unknown;
  let brokenReason: string | undefined;

  let raw: string | null = null;
  try {
    raw = await readFile(manifestPath, 'utf-8');
  } catch (err) {
    brokenReason = isENOENT(err) ? 'manifest.json missing' : err instanceof Error ? err.message : String(err);
  }

  if (raw !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      brokenReason = 'manifest.json is not valid JSON';
    }
    if (brokenReason === undefined) {
      const validated = ManifestSchema.safeParse(parsed);
      if (validated.success) {
        manifest = validated.data;
      } else {
        const first = validated.error.issues[0];
        brokenReason = first
          ? `manifest failed validation at ${first.path.join('.') || '<root>'}: ${first.message}`
          : 'manifest failed validation';
        partialManifest = parsed;
      }
    }
  }

  const directorySize = await safeDirectorySize(snapshotDir);
  return {
    shop,
    snapshotId,
    snapshotDir,
    manifest,
    ...(partialManifest !== undefined ? { partialManifest } : {}),
    brokenReason,
    directorySize,
  };
}

async function safeStat(path: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

async function safeReaddir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

async function safeDirectorySize(dir: string): Promise<number> {
  try {
    return await directorySize(dir);
  } catch {
    return 0;
  }
}

async function directorySize(dir: string): Promise<number> {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(path);
    } else if (entry.isFile()) {
      const s = await stat(path);
      total += s.size;
    }
  }
  return total;
}

function sortSnapshots(snapshots: DiscoveredSnapshot[]): DiscoveredSnapshot[] {
  return [...snapshots].sort((a, b) => {
    if (a.shop !== b.shop) return a.shop.localeCompare(b.shop);
    return b.snapshotId.localeCompare(a.snapshotId);
  });
}

function applyLimit(
  snapshots: DiscoveredSnapshot[],
  limit: number | null,
): DiscoveredSnapshot[] {
  if (limit === null) return snapshots;
  const counts = new Map<string, number>();
  return snapshots.filter((s) => {
    const c = counts.get(s.shop) ?? 0;
    if (c >= limit) return false;
    counts.set(s.shop, c + 1);
    return true;
  });
}
