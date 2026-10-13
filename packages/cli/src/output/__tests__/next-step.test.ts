import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextStep, readLocalState, shouldShowNextStep } from '../next-step';

describe('shouldShowNextStep', () => {
  const tty = { isTTY: true };
  const notTty = { isTTY: false };
  it('true only for empty argv at an interactive TTY', () => {
    expect(shouldShowNextStep([], { stdout: tty, stdin: tty })).toBe(true);
  });
  it('false when argv is non-empty', () => {
    expect(shouldShowNextStep(['snapshot'], { stdout: tty, stdin: tty })).toBe(false);
  });
  it('false when not a TTY (piped/non-interactive)', () => {
    expect(shouldShowNextStep([], { stdout: tty, stdin: notTty })).toBe(false);
  });
  it('false when stdout is not a TTY even if stdin is (redirected output)', () => {
    expect(shouldShowNextStep([], { stdout: notTty, stdin: tty })).toBe(false);
  });
});

describe('nextStep', () => {
  it('unconfigured: no shop', () => {
    expect(nextStep({ shop: undefined, snapshotCount: 0, latestSnapshotId: undefined })).toBe(
      'No store configured. Set SHOPIFY_SHOP_DOMAIN, SHOPIFY_CLIENT_ID, and SHOPIFY_CLIENT_SECRET in .env',
    );
  });

  it('empty: shop but no snapshots', () => {
    expect(nextStep({ shop: 'ex.myshopify.com', snapshotCount: 0, latestSnapshotId: undefined })).toBe(
      'No snapshots for ex.myshopify.com. Next: fallback snapshot',
    );
  });

  it('ready: shop and snapshots', () => {
    expect(
      nextStep({ shop: 'ex.myshopify.com', snapshotCount: 3, latestSnapshotId: '2026-05-29T04-24-50Z' }),
    ).toBe('3 snapshots for ex.myshopify.com. Next: fallback diff 2026-05-29T04-24-50Z');
  });
});

describe('readLocalState', () => {
  let base: string;
  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'fb-ns-'));
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('reports count and the newest (lexicographically greatest) id', async () => {
    const shopDir = join(base, 'ex.myshopify.com');
    await mkdir(join(shopDir, '2026-05-28T10-00-00Z'), { recursive: true });
    await mkdir(join(shopDir, '2026-05-29T04-24-50Z'), { recursive: true });
    const state = await readLocalState({
      cwd: '/no/such',
      homeDir: '/no/such',
      processEnv: { SHOPIFY_SHOP_DOMAIN: 'ex.myshopify.com' },
      baseDir: base,
    });
    expect(state.shop).toBe('ex.myshopify.com');
    expect(state.snapshotCount).toBe(2);
    expect(state.latestSnapshotId).toBe('2026-05-29T04-24-50Z');
  });

  it('returns zero/undefined when the shop dir is absent', async () => {
    const state = await readLocalState({
      cwd: '/no/such',
      homeDir: '/no/such',
      processEnv: { SHOPIFY_SHOP_DOMAIN: 'missing.myshopify.com' },
      baseDir: base,
    });
    expect(state).toEqual({ shop: 'missing.myshopify.com', snapshotCount: 0, latestSnapshotId: undefined });
  });

  it('returns shop undefined when nothing configures it', async () => {
    const state = await readLocalState({ cwd: '/no/such', homeDir: '/no/such', processEnv: {}, baseDir: base });
    expect(state.shop).toBeUndefined();
  });

  it('ignores regular files sitting alongside snapshot directories', async () => {
    const shopDir = join(base, 'ex.myshopify.com');
    await mkdir(join(shopDir, '2026-05-29T04-24-50Z'), { recursive: true });
    // Lexicographically greatest entry: if the isDirectory() guard were missing,
    // this file would wrongly win as the latest snapshot and inflate the count.
    await writeFile(join(shopDir, 'zzz-not-a-snapshot.json'), '{}', 'utf-8');
    const state = await readLocalState({
      cwd: '/no/such',
      homeDir: '/no/such',
      processEnv: { SHOPIFY_SHOP_DOMAIN: 'ex.myshopify.com' },
      baseDir: base,
    });
    expect(state.snapshotCount).toBe(1);
    expect(state.latestSnapshotId).toBe('2026-05-29T04-24-50Z');
  });
});
