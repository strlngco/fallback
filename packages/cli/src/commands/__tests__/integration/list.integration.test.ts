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

describe.runIf(SHOULD_RUN)('list (integration)', () => {
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
    'shows a freshly-captured snapshot in the listing',
    async () => {
      const snap = await runCLI(['snapshot', '--base-dir', baseDir, '--json']);
      expect(snap.exitCode, `snapshot stderr: ${snap.stderr}`).toBe(0);
      const snapSummary = JSON.parse(snap.stdout) as { snapshotId: string };

      const listResult = await runCLI(['list', '--base-dir', baseDir, '--json']);
      expect(listResult.exitCode, `list stderr: ${listResult.stderr}`).toBe(0);

      const listed = JSON.parse(listResult.stdout) as Array<{
        snapshotId?: string;
        broken?: boolean;
      }>;
      expect(Array.isArray(listed)).toBe(true);
      expect(listed.length).toBeGreaterThanOrEqual(1);

      const found = listed.find((entry) => entry.snapshotId === snapSummary.snapshotId);
      expect(found, `snapshot ${snapSummary.snapshotId} should appear in list output`).toBeDefined();
      expect(found?.broken).not.toBe(true);
    },
    60000,
  );
});
