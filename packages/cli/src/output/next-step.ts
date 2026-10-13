import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { resolveShopDomain } from '../env';
import { outputMode } from './mode';
import { defaultBaseDir } from './paths';

export interface LocalState {
  shop: string | undefined;
  snapshotCount: number;
  latestSnapshotId: string | undefined;
}

export function shouldShowNextStep(
  argv: string[],
  streams: { stdout: { isTTY?: boolean }; stdin: { isTTY?: boolean } },
): boolean {
  if (argv.length !== 0) return false;
  return outputMode({ json: false, quiet: false, stdout: streams.stdout, stdin: streams.stdin }) === 'interactive';
}

export function nextStep(state: LocalState): string {
  if (state.shop === undefined) {
    return 'No store configured. Set SHOPIFY_SHOP_DOMAIN, SHOPIFY_CLIENT_ID, and SHOPIFY_CLIENT_SECRET in .env';
  }
  if (state.snapshotCount === 0) {
    return `No snapshots for ${state.shop}. Next: fallback snapshot`;
  }
  return `${state.snapshotCount} snapshots for ${state.shop}. Next: fallback diff ${state.latestSnapshotId}`;
}

export async function readLocalState(deps: {
  cwd: string;
  homeDir: string;
  processEnv: Record<string, string | undefined>;
  baseDir?: string;
}): Promise<LocalState> {
  const shop = await resolveShopDomain({
    cwd: deps.cwd,
    homeDir: deps.homeDir,
    processEnv: deps.processEnv,
  });
  if (shop === undefined) {
    return { shop: undefined, snapshotCount: 0, latestSnapshotId: undefined };
  }
  const baseDir = deps.baseDir ?? defaultBaseDir(deps.homeDir);
  const ids = await snapshotIds(join(baseDir, shop));
  return {
    shop,
    snapshotCount: ids.length,
    latestSnapshotId: ids[0],
  };
}

async function snapshotIds(shopDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(shopDir);
  } catch {
    return [];
  }
  const dirs: string[] = [];
  for (const name of entries) {
    try {
      const s = await stat(join(shopDir, name));
      if (s.isDirectory()) dirs.push(name);
    } catch {
      // ignore unreadable entries
    }
  }
  return dirs.sort((a, b) => b.localeCompare(a));
}
