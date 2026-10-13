// Integration test — requires `pnpm build` and SHOPIFY_SHOP_DOMAIN /
// SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET. Gated by INTEGRATION=1.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ManifestSchema } from '@strlngco/fallback-core';

import {
  assertIntegrationEnv,
  cleanupTempBaseDir,
  createTempBaseDir,
  runCLI,
} from './cleanup';

const SHOULD_RUN = process.env['INTEGRATION'] === '1';

describe.runIf(SHOULD_RUN)('snapshot (integration)', () => {
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
    'captures a snapshot whose manifest validates and whose NDJSON files contain valid JSON',
    async () => {
      const { exitCode, stdout, stderr } = await runCLI([
        'snapshot',
        '--base-dir',
        baseDir,
        '--json',
      ]);
      expect(exitCode, `stderr was: ${stderr}`).toBe(0);

      const summary = JSON.parse(stdout) as {
        snapshotId: string;
        snapshotDir: string;
        manifestPath: string;
      };
      expect(summary.snapshotId).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/);
      expect(summary.snapshotDir).toContain(baseDir);

      // Manifest validates against the canonical schema.
      const manifestRaw = await readFile(summary.manifestPath, 'utf-8');
      const manifest = ManifestSchema.parse(JSON.parse(manifestRaw));
      expect(manifest.version).toBe(1);
      expect(manifest.snapshotId).toBe(summary.snapshotId);

      // Counts are non-negative integers (structural, not specific values).
      for (const key of ['products', 'variants', 'collections', 'metafields', 'inventoryLevels'] as const) {
        expect(Number.isInteger(manifest.counts[key])).toBe(true);
        expect(manifest.counts[key]).toBeGreaterThanOrEqual(0);
      }

      // All four NDJSON files exist; each non-empty line parses as JSON.
      const ndjsonFiles = [
        'products.ndjson',
        'collections.ndjson',
        'metafields.ndjson',
        'inventory-levels.ndjson',
      ] as const;
      for (const filename of ndjsonFiles) {
        const path = join(summary.snapshotDir, filename);
        expect(existsSync(path), `${filename} should exist`).toBe(true);
        const content = await readFile(path, 'utf-8');
        const lines = content.split('\n').filter((l) => l.length > 0);
        for (const line of lines) {
          expect(() => JSON.parse(line), `${filename} line: ${line.slice(0, 80)}`).not.toThrow();
        }
      }
    },
    30000,
  );
});
