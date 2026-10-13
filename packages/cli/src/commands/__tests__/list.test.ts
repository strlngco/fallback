import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { Cli } from 'clipanion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Manifest } from '@strlngco/fallback-core';

import { ListCommand } from '../list';
import {
  SnapshotCommand,
  type SnapshotContext,
  type SnapshotDependencies,
} from '../snapshot';

interface CommandRun {
  exit: number;
  stdout: string;
  stderr: string;
}

function makeDeps(overrides: Partial<SnapshotDependencies> = {}): SnapshotDependencies {
  const noop = vi.fn();
  const base: SnapshotDependencies = {
    buildClient: vi.fn() as unknown as SnapshotDependencies['buildClient'],
    buildWriter: vi.fn() as unknown as SnapshotDependencies['buildWriter'],
    fetchers: {
      products: noop as unknown as SnapshotDependencies['fetchers']['products'],
      collections: noop as unknown as SnapshotDependencies['fetchers']['collections'],
      metafields: noop as unknown as SnapshotDependencies['fetchers']['metafields'],
      variantMetafields: noop as unknown as SnapshotDependencies['fetchers']['variantMetafields'],
      collectionMetafields:
        noop as unknown as SnapshotDependencies['fetchers']['collectionMetafields'],
      shopMetafields: noop as unknown as SnapshotDependencies['fetchers']['shopMetafields'],
      metafieldDefinitions:
        noop as unknown as SnapshotDependencies['fetchers']['metafieldDefinitions'],
      metaobjectDefinitions:
        noop as unknown as SnapshotDependencies['fetchers']['metaobjectDefinitions'],
      metaobjects: noop as unknown as SnapshotDependencies['fetchers']['metaobjects'],
      inventoryLevels: noop as unknown as SnapshotDependencies['fetchers']['inventoryLevels'],
    },
    resolveAuth: vi.fn(),
    now: () => new Date('2026-05-28T12:00:00.000Z'),
    cwd: () => '/tmp/cwd',
    homeDir: () => '/tmp/home',
    env: () => ({}),
  };
  return { ...base, ...overrides };
}

async function runList(args: string[], deps: SnapshotDependencies): Promise<CommandRun> {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const stdout = new Writable({
    write(chunk: Buffer | string, _enc, cb) {
      stdoutChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      cb();
    },
  });
  const stderr = new Writable({
    write(chunk: Buffer | string, _enc, cb) {
      stderrChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      cb();
    },
  });

  const cli = new Cli<SnapshotContext>({ binaryName: 'fallback' });
  cli.register(ListCommand);
  cli.register(SnapshotCommand);

  const exit = await cli.run(args, {
    stdin: Readable.from([]),
    stdout,
    stderr,
    env: { ...process.env, NO_COLOR: '1' },
    colorDepth: 0,
    deps,
  });

  return {
    exit: exit ?? 0,
    stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
    stderr: stripAnsi(Buffer.concat(stderrChunks).toString('utf-8')),
  };
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function buildManifest(opts: {
  shop: string;
  snapshotId: string;
  capturedAt: string;
  scope?: Partial<Manifest['scope']>;
  counts?: Partial<Manifest['counts']>;
}): Manifest {
  return {
    version: 1,
    shop: opts.shop,
    capturedAt: opts.capturedAt,
    apiVersion: '2026-04',
    fallbackVersion: '0.1.0',
    scope: {
      products: true,
      collections: true,
      metafields: true,
      inventoryLevels: true,
      themes: false,
      customers: false,
      orders: false,
      discounts: false,
      ...opts.scope,
    },
    counts: {
      products: 12,
      variants: 29,
      collections: 1,
      metafields: 16,
      inventoryLevels: 29,
      ...opts.counts,
    },
    durationMs: 1234,
    snapshotId: opts.snapshotId,
  };
}

async function createSnapshot(opts: {
  baseDir: string;
  shop: string;
  snapshotId: string;
  manifest?: object | string;
  extraBytes?: number;
}): Promise<string> {
  const dir = join(opts.baseDir, opts.shop, opts.snapshotId);
  await mkdir(dir, { recursive: true });
  if (opts.manifest !== undefined) {
    const content =
      typeof opts.manifest === 'string'
        ? opts.manifest
        : JSON.stringify(opts.manifest, null, 2);
    await writeFile(join(dir, 'manifest.json'), content, 'utf-8');
  }
  await writeFile(join(dir, 'products.ndjson'), 'x'.repeat(opts.extraBytes ?? 50), 'utf-8');
  return dir;
}

let baseDir: string;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'fallback-list-test-'));
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

describe('ListCommand', () => {
  it('rejects a --shop value that is not a myshopify.com domain with exit 1', async () => {
    const { exit, stderr } = await runList(
      ['list', '--base-dir', baseDir, '--shop', '../..'],
      makeDeps(),
    );
    expect(exit).toBe(1);
    expect(stderr).toContain('myshopify.com');
  });

  it('prints "No snapshots found" with exit 0 when the base dir is empty', async () => {
    const { exit, stderr, stdout } = await runList(
      ['list', '--base-dir', baseDir],
      makeDeps(),
    );
    expect(exit).toBe(0);
    expect(stdout).toBe('');
    expect(stderr).toContain('No snapshots found');
    expect(stderr).toContain(baseDir);
  });

  it('prints "No snapshots found" when the base dir does not exist', async () => {
    const missing = join(baseDir, 'does-not-exist');
    const { exit, stderr } = await runList(
      ['list', '--base-dir', missing],
      makeDeps(),
    );
    expect(exit).toBe(0);
    expect(stderr).toContain('No snapshots found');
  });

  it('lists snapshots from a single shop, newest first', async () => {
    await createSnapshot({
      baseDir,
      shop: 'example.myshopify.com',
      snapshotId: '2026-05-28T10-00-00Z',
      manifest: buildManifest({
        shop: 'example.myshopify.com',
        snapshotId: '2026-05-28T10-00-00Z',
        capturedAt: '2026-05-28T10:00:00.000Z',
      }),
    });
    await createSnapshot({
      baseDir,
      shop: 'example.myshopify.com',
      snapshotId: '2026-05-27T08-00-00Z',
      manifest: buildManifest({
        shop: 'example.myshopify.com',
        snapshotId: '2026-05-27T08-00-00Z',
        capturedAt: '2026-05-27T08:00:00.000Z',
      }),
    });

    const { exit, stderr } = await runList(
      ['list', '--base-dir', baseDir],
      makeDeps(),
    );
    expect(exit).toBe(0);
    expect(stderr).toContain('example.myshopify.com');
    const firstIdx = stderr.indexOf('2026-05-28T10-00-00Z');
    const secondIdx = stderr.indexOf('2026-05-27T08-00-00Z');
    expect(firstIdx).toBeGreaterThanOrEqual(0);
    expect(secondIdx).toBeGreaterThan(firstIdx);
  });

  it('groups snapshots by shop with sections in alphabetical shop order', async () => {
    await createSnapshot({
      baseDir,
      shop: 'b-shop.myshopify.com',
      snapshotId: '2026-05-28T10-00-00Z',
      manifest: buildManifest({
        shop: 'b-shop.myshopify.com',
        snapshotId: '2026-05-28T10-00-00Z',
        capturedAt: '2026-05-28T10:00:00.000Z',
      }),
    });
    await createSnapshot({
      baseDir,
      shop: 'a-shop.myshopify.com',
      snapshotId: '2026-05-27T08-00-00Z',
      manifest: buildManifest({
        shop: 'a-shop.myshopify.com',
        snapshotId: '2026-05-27T08-00-00Z',
        capturedAt: '2026-05-27T08:00:00.000Z',
      }),
    });

    const { exit, stderr } = await runList(
      ['list', '--base-dir', baseDir],
      makeDeps(),
    );
    expect(exit).toBe(0);
    const aIdx = stderr.indexOf('a-shop.myshopify.com');
    const bIdx = stderr.indexOf('b-shop.myshopify.com');
    expect(aIdx).toBeGreaterThanOrEqual(0);
    expect(bIdx).toBeGreaterThan(aIdx);
  });

  it('renders snapshots with a missing manifest as (broken: manifest.json missing) and dashes', async () => {
    await createSnapshot({
      baseDir,
      shop: 'example.myshopify.com',
      snapshotId: '2026-05-28T10-00-00Z',
      // no manifest
    });
    const { exit, stderr } = await runList(
      ['list', '--base-dir', baseDir],
      makeDeps(),
    );
    expect(exit).toBe(0);
    expect(stderr).toContain('2026-05-28T10-00-00Z');
    expect(stderr).toContain('(broken: manifest.json missing)');
    expect(stderr).toMatch(/-\s+-\s+-/);
  });

  it('renders invalid JSON as (broken: manifest.json is not valid JSON)', async () => {
    await createSnapshot({
      baseDir,
      shop: 'example.myshopify.com',
      snapshotId: '2026-05-28T10-00-00Z',
      manifest: 'not json{',
    });
    const { exit, stderr } = await runList(
      ['list', '--base-dir', baseDir],
      makeDeps(),
    );
    expect(exit).toBe(0);
    expect(stderr).toContain('broken: manifest.json is not valid JSON');
  });

  it('renders schema-mismatch as (broken: manifest failed validation ...)', async () => {
    await createSnapshot({
      baseDir,
      shop: 'example.myshopify.com',
      snapshotId: '2026-05-28T10-00-00Z',
      manifest: { version: 99 },
    });
    const { exit, stderr } = await runList(
      ['list', '--base-dir', baseDir],
      makeDeps(),
    );
    expect(exit).toBe(0);
    expect(stderr).toContain('broken: manifest failed validation');
  });

  it('filters by --shop', async () => {
    await createSnapshot({
      baseDir,
      shop: 'a-shop.myshopify.com',
      snapshotId: '2026-05-28T10-00-00Z',
      manifest: buildManifest({
        shop: 'a-shop.myshopify.com',
        snapshotId: '2026-05-28T10-00-00Z',
        capturedAt: '2026-05-28T10:00:00.000Z',
      }),
    });
    await createSnapshot({
      baseDir,
      shop: 'b-shop.myshopify.com',
      snapshotId: '2026-05-28T09-00-00Z',
      manifest: buildManifest({
        shop: 'b-shop.myshopify.com',
        snapshotId: '2026-05-28T09-00-00Z',
        capturedAt: '2026-05-28T09:00:00.000Z',
      }),
    });

    const { exit, stderr } = await runList(
      ['list', '--base-dir', baseDir, '--shop', 'a-shop.myshopify.com'],
      makeDeps(),
    );
    expect(exit).toBe(0);
    expect(stderr).toContain('a-shop.myshopify.com');
    expect(stderr).not.toContain('b-shop.myshopify.com');
  });

  it('keeps only the most recent --limit N snapshots per shop', async () => {
    for (let day = 20; day <= 24; day++) {
      const id = `2026-05-${day}T00-00-00Z`;
      await createSnapshot({
        baseDir,
        shop: 'example.myshopify.com',
        snapshotId: id,
        manifest: buildManifest({
          shop: 'example.myshopify.com',
          snapshotId: id,
          capturedAt: `2026-05-${day}T00:00:00.000Z`,
        }),
      });
    }
    const { exit, stderr } = await runList(
      ['list', '--base-dir', baseDir, '--limit', '2'],
      makeDeps(),
    );
    expect(exit).toBe(0);
    expect(stderr).toContain('2026-05-24T00-00-00Z');
    expect(stderr).toContain('2026-05-23T00-00-00Z');
    expect(stderr).not.toContain('2026-05-22T00-00-00Z');
    expect(stderr).not.toContain('2026-05-21T00-00-00Z');
  });

  it('rejects --limit with a non-integer value (exit 1)', async () => {
    const { exit, stderr } = await runList(
      ['list', '--base-dir', baseDir, '--limit', 'foo'],
      makeDeps(),
    );
    expect(exit).toBe(1);
    expect(stderr).toContain('--limit');
  });

  it('rejects --limit with a non-positive integer (exit 1)', async () => {
    const { exit, stderr } = await runList(
      ['list', '--base-dir', baseDir, '--limit', '0'],
      makeDeps(),
    );
    expect(exit).toBe(1);
    expect(stderr).toContain('--limit');
  });

  it('emits JSON with the full manifest plus directorySize and directoryPath', async () => {
    const manifest = buildManifest({
      shop: 'example.myshopify.com',
      snapshotId: '2026-05-28T10-00-00Z',
      capturedAt: '2026-05-28T10:00:00.000Z',
    });
    await createSnapshot({
      baseDir,
      shop: 'example.myshopify.com',
      snapshotId: '2026-05-28T10-00-00Z',
      manifest,
      extraBytes: 100,
    });
    const { exit, stdout, stderr } = await runList(
      ['list', '--base-dir', baseDir, '--json'],
      makeDeps(),
    );
    expect(exit).toBe(0);
    expect(stderr).toBe('');
    const parsed = JSON.parse(stdout) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.['snapshotId']).toBe('2026-05-28T10-00-00Z');
    expect(parsed[0]?.['shop']).toBe('example.myshopify.com');
    expect(parsed[0]?.['version']).toBe(1);
    expect(parsed[0]?.['directoryPath']).toContain('2026-05-28T10-00-00Z');
    expect(typeof parsed[0]?.['directorySize']).toBe('number');
    expect(parsed[0]?.['directorySize']).toBeGreaterThan(0);
  });

  it('emits [] in JSON when no snapshots exist', async () => {
    const { exit, stdout } = await runList(
      ['list', '--base-dir', baseDir, '--json'],
      makeDeps(),
    );
    expect(exit).toBe(0);
    const parsed = JSON.parse(stdout) as unknown[];
    expect(parsed).toEqual([]);
  });

  it('emits broken: true with brokenReason and partialManifest in JSON for schema failures', async () => {
    await createSnapshot({
      baseDir,
      shop: 'example.myshopify.com',
      snapshotId: '2026-05-28T10-00-00Z',
      manifest: { version: 99, shop: 'partial.myshopify.com' },
    });
    const { exit, stdout } = await runList(
      ['list', '--base-dir', baseDir, '--json'],
      makeDeps(),
    );
    expect(exit).toBe(0);
    const parsed = JSON.parse(stdout) as Array<Record<string, unknown>>;
    expect(parsed[0]?.['broken']).toBe(true);
    expect(parsed[0]?.['brokenReason']).toContain('validation');
    expect(parsed[0]?.['partialManifest']).toEqual({
      version: 99,
      shop: 'partial.myshopify.com',
    });
  });

  it('emits broken: true without partialManifest when manifest.json is missing', async () => {
    await createSnapshot({
      baseDir,
      shop: 'example.myshopify.com',
      snapshotId: '2026-05-28T10-00-00Z',
    });
    const { exit, stdout } = await runList(
      ['list', '--base-dir', baseDir, '--json'],
      makeDeps(),
    );
    expect(exit).toBe(0);
    const parsed = JSON.parse(stdout) as Array<Record<string, unknown>>;
    expect(parsed[0]?.['broken']).toBe(true);
    expect(parsed[0]?.['brokenReason']).toContain('missing');
    expect(parsed[0]).not.toHaveProperty('partialManifest');
  });

  it('renders capturedAt as a relative time anchored to deps.now()', async () => {
    await createSnapshot({
      baseDir,
      shop: 'example.myshopify.com',
      snapshotId: '2026-05-28T10-00-00Z',
      manifest: buildManifest({
        shop: 'example.myshopify.com',
        snapshotId: '2026-05-28T10-00-00Z',
        capturedAt: '2026-05-28T10:00:00.000Z',
      }),
    });
    // now() returns 2026-05-28T12:00:00Z → 2 hours after capture
    const { exit, stderr } = await runList(
      ['list', '--base-dir', baseDir],
      makeDeps(),
    );
    expect(exit).toBe(0);
    expect(stderr).toContain('2 hours ago');
  });

  it('list --json emits byte-stable stdout (healthy)', async () => {
    const manifest = buildManifest({
      shop: 'example.myshopify.com',
      snapshotId: '2026-05-28T10-00-00Z',
      capturedAt: '2026-05-28T10:00:00.000Z',
    });
    await createSnapshot({
      baseDir,
      shop: 'example.myshopify.com',
      snapshotId: '2026-05-28T10-00-00Z',
      manifest,
      extraBytes: 100,
    });
    const { exit, stdout } = await runList(['list', '--base-dir', baseDir, '--json'], makeDeps());
    expect(exit).toBe(0);
    // Replace the tmpdir path so directoryPath is stable across test runs.
    expect(stdout.replaceAll(baseDir, '<BASE_DIR>')).toMatchSnapshot();
  });

  it('list --json emits [] for an empty base dir', async () => {
    const { stdout } = await runList(['list', '--base-dir', baseDir, '--json'], makeDeps());
    expect(stdout).toBe('[]\n');
  });

  it('list --json emits byte-stable stdout (broken entry)', async () => {
    await createSnapshot({
      baseDir,
      shop: 'example.myshopify.com',
      snapshotId: '2026-05-28T10-00-00Z',
      // no manifest — broken entry has brokenReason: 'manifest.json missing'
    });
    const { stdout } = await runList(['list', '--base-dir', baseDir, '--json'], makeDeps());
    // Replace the tmpdir path so directoryPath is stable across test runs.
    expect(stdout.replaceAll(baseDir, '<BASE_DIR>')).toMatchSnapshot();
  });
});
