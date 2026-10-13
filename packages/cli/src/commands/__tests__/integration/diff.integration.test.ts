// Integration test — requires `pnpm build` and SHOPIFY_SHOP_DOMAIN /
// SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET. Gated by INTEGRATION=1.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  assertIntegrationEnv,
  cleanupTempBaseDir,
  createTempBaseDir,
  runCLI,
} from './cleanup';

const SHOULD_RUN = process.env['INTEGRATION'] === '1';

interface ResourceDiff {
  created: unknown[];
  updated: unknown[];
  deleted: unknown[];
  unchanged: number;
  snapshotCount: number;
  currentCount: number;
  ignoredCount: number;
}

interface SnapshotDiff {
  snapshotId: string;
  shop: string;
  computedAt: string;
  resources: Record<string, ResourceDiff>;
}

describe.runIf(SHOULD_RUN)('diff (integration)', () => {
  let baseDir: string;

  beforeAll(() => {
    assertIntegrationEnv();
  });

  beforeAll(async () => {
    baseDir = await createTempBaseDir();
  });

  afterAll(async () => {
    await cleanupTempBaseDir(baseDir);
  });

  it(
    'produces zero created/updated/deleted across every resource when diffing a fresh snapshot against itself',
    async () => {
      const snap = await runCLI(['snapshot', '--base-dir', baseDir, '--json']);
      expect(snap.exitCode, `snapshot stderr: ${snap.stderr}`).toBe(0);
      const snapSummary = JSON.parse(snap.stdout) as { snapshotId: string };

      const diffResult = await runCLI([
        'diff',
        snapSummary.snapshotId,
        '--base-dir',
        baseDir,
        '--json',
      ]);
      expect(diffResult.exitCode, `diff stderr: ${diffResult.stderr}`).toBe(0);

      const diff = JSON.parse(diffResult.stdout) as SnapshotDiff;
      expect(diff.snapshotId).toBe(snapSummary.snapshotId);
      expect(Object.keys(diff.resources).length).toBeGreaterThan(0);

      for (const [key, resource] of Object.entries(diff.resources)) {
        expect(resource.created, `${key}.created should be empty`).toEqual([]);
        expect(resource.updated, `${key}.updated should be empty`).toEqual([]);
        expect(resource.deleted, `${key}.deleted should be empty`).toEqual([]);
        expect(Number.isInteger(resource.unchanged)).toBe(true);
        expect(Number.isInteger(resource.snapshotCount)).toBe(true);
        expect(Number.isInteger(resource.currentCount)).toBe(true);
      }
    },
    60000,
  );
});
