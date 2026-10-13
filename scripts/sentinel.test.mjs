import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SCOPE,
  buildIssuePayload,
  createIssue,
  evaluateDrift,
  latestSnapshotId,
  runSentinel,
  runSentinelWithReporting,
} from './sentinel.mjs';

const SHOP = 'example.myshopify.com';

function resource(created, updated, deleted) {
  return {
    created: Array.from({ length: created }, (_, i) => ({ id: `c${i}` })),
    updated: Array.from({ length: updated }, (_, i) => ({ id: `u${i}` })),
    deleted: Array.from({ length: deleted }, (_, i) => ({ id: `d${i}` })),
    unchanged: 0,
    snapshotCount: 0,
    currentCount: 0,
    ignoredCount: 0,
  };
}

test('latestSnapshotId picks the newest id for the shop', () => {
  const entries = [
    { shop: SHOP, snapshotId: '2026-07-01T09-00-00Z' },
    { shop: 'other.myshopify.com', snapshotId: '2026-07-09T09-00-00Z' },
    { shop: SHOP, snapshotId: '2026-07-03T09-00-00Z' },
    { shop: SHOP, snapshotId: '2026-07-02T09-00-00Z' },
  ];
  assert.equal(latestSnapshotId(entries, SHOP), '2026-07-03T09-00-00Z');
});

test('latestSnapshotId returns null when the shop has no snapshots', () => {
  assert.equal(latestSnapshotId([{ shop: 'other.myshopify.com', snapshotId: 'x' }], SHOP), null);
  assert.equal(latestSnapshotId([], SHOP), null);
});

function brokenEntry(overrides = {}) {
  return {
    broken: true,
    brokenReason: 'manifest.json missing',
    shop: SHOP,
    snapshotId: '2026-07-03T09-00-00Z',
    directoryPath: `/home/.fallback/snapshots/${SHOP}/2026-07-03T09-00-00Z`,
    directorySize: 4096,
    ...overrides,
  };
}

test('latestSnapshotId skips a broken latest entry in favor of an older healthy one', () => {
  const entries = [
    { shop: SHOP, snapshotId: '2026-07-01T09-00-00Z' },
    brokenEntry(),
  ];
  assert.equal(latestSnapshotId(entries, SHOP), '2026-07-01T09-00-00Z');
});

test('latestSnapshotId returns null when every entry for the shop is broken', () => {
  const entries = [
    brokenEntry({ snapshotId: '2026-07-01T09-00-00Z' }),
    brokenEntry({ snapshotId: '2026-07-02T09-00-00Z' }),
  ];
  assert.equal(latestSnapshotId(entries, SHOP), null);
});

test('evaluateDrift is quiet when every resource is unchanged', () => {
  const out = evaluateDrift({ resources: { products: resource(0, 0, 0), metaobjects: resource(0, 0, 0) } });
  assert.equal(out.drifted, false);
  assert.deepEqual(out.summary, []);
});

test('evaluateDrift reports one line per drifted resource', () => {
  const out = evaluateDrift({
    resources: {
      products: resource(0, 2, 0),
      metafields: resource(1, 0, 3),
      metaobjects: resource(0, 0, 0),
    },
  });
  assert.equal(out.drifted, true);
  assert.deepEqual(out.summary, ['products: +0 ~2 -0', 'metafields: +1 ~0 -3']);
});

test('evaluateDrift tolerates an empty resources object', () => {
  assert.equal(evaluateDrift({ resources: {} }).drifted, false);
});

test('DEFAULT_SCOPE excludes inventory levels', () => {
  assert.equal(DEFAULT_SCOPE, 'products,collections,metafields,metaobjects');
});

const QUIET_DIFF = JSON.stringify({ resources: { products: { created: [], updated: [], deleted: [], unchanged: 1, snapshotCount: 1, currentCount: 1, ignoredCount: 0 } } });
const DRIFT_DIFF = JSON.stringify({ resources: { products: { created: [], updated: [{ id: 'u' }], deleted: [], unchanged: 0, snapshotCount: 1, currentCount: 1, ignoredCount: 0 } } });
const LIST_ONE = JSON.stringify([
  scopedEntry('2026-07-01T09-00-00Z', {
    products: true,
    collections: true,
    metafields: true,
    metaobjects: true,
  }),
]);

function fakeDeps(script) {
  const lines = [];
  const calls = [];
  return {
    lines,
    calls,
    deps: {
      env: { SHOPIFY_SHOP_DOMAIN: SHOP, ...script.env },
      log: (l) => lines.push(l),
      runCli: async (args) => {
        calls.push(args);
        const step = script.responses.shift();
        if (step === undefined) throw new Error(`unexpected CLI call: ${args.join(' ')}`);
        return step;
      },
    },
  };
}

test('first run takes a baseline and exits 0', async () => {
  const t = fakeDeps({
    responses: [
      { code: 0, stdout: '[]', stderr: '' },
      { code: 0, stdout: '', stderr: 'Captured 12 products.' },
    ],
  });
  assert.equal(await runSentinel(t.deps), 0);
  assert.deepEqual(t.calls[0], ['list', '--json']);
  assert.equal(t.calls[1][0], 'snapshot');
  assert.ok(t.lines.some((l) => l.includes('FIRST RUN')));
});

function scopedEntry(snapshotId, scope) {
  return {
    shop: SHOP,
    snapshotId,
    scope: {
      products: false,
      collections: false,
      metafields: false,
      inventoryLevels: false,
      metaobjects: false,
      ...scope,
    },
  };
}

test('latestSnapshotId skips snapshots that did not capture the requested scope', () => {
  const entries = [
    scopedEntry('2026-07-01T09-00-00Z', { products: true, inventoryLevels: true }),
    scopedEntry('2026-07-02T09-00-00Z', { products: true }),
  ];
  assert.equal(latestSnapshotId(entries, SHOP, 'products,inventory-levels'), '2026-07-01T09-00-00Z');
  assert.equal(latestSnapshotId(entries, SHOP, 'products'), '2026-07-02T09-00-00Z');
});

test('a widened SENTINEL_SCOPE re-baselines instead of failing the diff every day', async () => {
  const listed = [scopedEntry('2026-07-02T09-00-00Z', { products: true, collections: true })];
  const t = fakeDeps({
    env: { SENTINEL_SCOPE: 'products,collections,inventory-levels' },
    responses: [
      { code: 0, stdout: JSON.stringify(listed), stderr: '' },
      { code: 0, stdout: '', stderr: 'Captured 12 products.' },
    ],
  });
  assert.equal(await runSentinel(t.deps), 0);
  assert.equal(t.calls.length, 2);
  assert.equal(t.calls[1][0], 'snapshot');
  assert.ok(t.lines.some((l) => l.includes('BASELINE RESET')));
});

test('quiet day diffs once, snapshots, exits 0', async () => {
  const t = fakeDeps({
    responses: [
      { code: 0, stdout: LIST_ONE, stderr: '' },
      { code: 0, stdout: QUIET_DIFF, stderr: '' },
      { code: 0, stdout: '', stderr: '' },
    ],
  });
  assert.equal(await runSentinel(t.deps), 0);
  assert.equal(t.calls.length, 3);
  assert.deepEqual(t.calls[1].slice(0, 2), ['diff', '2026-07-01T09-00-00Z']);
  assert.ok(t.calls[1].includes('--json'));
  assert.ok(t.lines.some((l) => l.includes('ALL QUIET')));
});

test('drifted day renders the human report from a single diff call, snapshots, exits 1', async () => {
  const t = fakeDeps({
    responses: [
      { code: 0, stdout: LIST_ONE, stderr: '' },
      { code: 0, stdout: DRIFT_DIFF, stderr: 'Products\n  Updated: 1' },
      { code: 0, stdout: '', stderr: '' },
    ],
  });
  const code = await runSentinel(t.deps);
  assert.equal(code, 1);
  assert.equal(t.calls.length, 3);
  assert.deepEqual(t.calls[1].slice(0, 2), ['diff', '2026-07-01T09-00-00Z']);
  assert.ok(t.calls[1].includes('--json'));
  assert.ok(t.calls[1].includes('--with-report'));
  assert.ok(t.lines.some((l) => l.includes('DRIFT REPORT')));
  assert.ok(t.lines.some((l) => l.includes('products: +0 ~1 -0')));
  assert.ok(t.lines.some((l) => l.includes('Updated: 1')));
  assert.ok(
    t.lines.some((l) =>
      l.includes(
        'deep dive: node packages/cli/dist/index.js diff 2026-07-01T09-00-00Z --scope products,collections,metafields,metaobjects --json',
      ),
    ),
  );
});

test('a failed diff logs the real error and never prints "report render failed"', async () => {
  const t = fakeDeps({
    responses: [
      { code: 0, stdout: LIST_ONE, stderr: '' },
      { code: 2, stdout: '', stderr: 'fallback: Shopify GraphQL throttled (429)' },
    ],
  });
  const code = await runSentinel(t.deps);
  assert.equal(code, 2);
  assert.equal(t.calls.length, 2);
  assert.ok(t.lines.some((l) => l.includes('SENTINEL FAILURE — diff')));
  assert.ok(t.lines.some((l) => l.includes('throttled (429)')));
  assert.ok(!t.lines.some((l) => l.includes('report render failed')));
});

test('deep dive line includes --base-dir only when FALLBACK_BASE_DIR is set', async () => {
  const withBaseDir = fakeDeps({
    env: { FALLBACK_BASE_DIR: '/var/data/snapshots' },
    responses: [
      { code: 0, stdout: LIST_ONE, stderr: '' },
      { code: 0, stdout: DRIFT_DIFF, stderr: 'Products\n  Updated: 1' },
      { code: 0, stdout: '', stderr: '' },
    ],
  });
  await runSentinel(withBaseDir.deps);
  assert.ok(
    withBaseDir.lines.some(
      (l) => l.includes('deep dive:') && l.includes('--base-dir /var/data/snapshots'),
    ),
  );

  const withoutBaseDir = fakeDeps({
    responses: [
      { code: 0, stdout: LIST_ONE, stderr: '' },
      { code: 0, stdout: DRIFT_DIFF, stderr: 'Products\n  Updated: 1' },
      { code: 0, stdout: '', stderr: '' },
    ],
  });
  await runSentinel(withoutBaseDir.deps);
  const deepDiveLine = withoutBaseDir.lines.find((l) => l.includes('deep dive:'));
  assert.ok(deepDiveLine);
  assert.ok(!deepDiveLine.includes('--base-dir'));
});

test('CLI failure reports the stage and exits 2', async () => {
  const t = fakeDeps({
    responses: [{ code: 2, stdout: '', stderr: 'fallback: Shopify GraphQL error' }],
  });
  assert.equal(await runSentinel(t.deps), 2);
  assert.ok(t.lines.some((l) => l.includes('SENTINEL FAILURE — list')));
  assert.ok(t.lines.some((l) => l.includes('Shopify GraphQL error')));
});

test('missing shop domain is a configuration failure', async () => {
  const t = fakeDeps({ responses: [] });
  t.deps.env = {};
  assert.equal(await runSentinel(t.deps), 2);
  assert.ok(t.lines.some((l) => l.includes('SENTINEL FAILURE — configuration')));
});

test('snapshot failure after drift still exits 2 with the drift lines printed', async () => {
  const t = fakeDeps({
    responses: [
      { code: 0, stdout: LIST_ONE, stderr: '' },
      { code: 0, stdout: DRIFT_DIFF, stderr: 'human report' },
      { code: 2, stdout: '', stderr: 'disk full' },
    ],
  });
  assert.equal(await runSentinel(t.deps), 2);
  assert.ok(t.lines.some((l) => l.includes('products: +0 ~1 -0')));
  assert.ok(t.lines.some((l) => l.includes('SENTINEL FAILURE — snapshot')));
});

test('FALLBACK_BASE_DIR and SENTINEL_SCOPE reach the CLI arguments', async () => {
  const t = fakeDeps({
    env: { FALLBACK_BASE_DIR: '/var/data/snapshots', SENTINEL_SCOPE: 'products' },
    responses: [
      { code: 0, stdout: '[]', stderr: '' },
      { code: 0, stdout: '', stderr: '' },
    ],
  });
  assert.equal(await runSentinel(t.deps), 0);
  assert.ok(t.calls[0].includes('--base-dir'));
  assert.ok(t.calls[0].includes('/var/data/snapshots'));
  assert.ok(t.calls[1].includes('--scope'));
  assert.ok(t.calls[1].includes('products'));
});

// --- GitHub reporting ---

test('buildIssuePayload titles a drift report (code 1)', () => {
  const { title } = buildIssuePayload(1, SHOP, '2026-07-07', ['line one']);
  assert.equal(title, `Fallback drift report — ${SHOP} — 2026-07-07`);
});

test('buildIssuePayload titles a sentinel failure (code 2)', () => {
  const { title } = buildIssuePayload(2, SHOP, '2026-07-07', ['line one']);
  assert.equal(title, `Fallback sentinel failure — ${SHOP} — 2026-07-07`);
});

test('buildIssuePayload fences the log lines verbatim when under the cap', () => {
  const { body } = buildIssuePayload(1, SHOP, '2026-07-07', ['=== DRIFT REPORT ===', 'products: +0 ~1 -0']);
  assert.equal(body, '```\n=== DRIFT REPORT ===\nproducts: +0 ~1 -0\n```');
});

test('buildIssuePayload truncates from the top and keeps the last lines under the GitHub cap', () => {
  const lines = Array.from({ length: 20000 }, (_, i) => `log line ${i} of the sentinel run with some padding text`);
  const { body } = buildIssuePayload(2, SHOP, '2026-07-07', lines);
  assert.ok(body.length <= 65536, `body length ${body.length} exceeds GitHub cap`);
  assert.ok(body.startsWith('```\n(report truncated; full log in Render)\n'));
  assert.ok(body.endsWith(`${lines.at(-1)}\n\`\`\``));
  assert.ok(!body.includes(lines[0]));
});

function fakeResponse({ status, htmlUrl, text }) {
  return {
    status,
    async json() {
      return { html_url: htmlUrl };
    },
    async text() {
      return text ?? '';
    },
  };
}

test('createIssue posts to the repo issues endpoint and returns the html_url on 201', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return fakeResponse({ status: 201, htmlUrl: 'https://github.com/acme/theme/issues/42' });
  };
  const env = { SENTINEL_REPORT_REPO: 'acme/theme', SENTINEL_GITHUB_TOKEN: 'tok_123' };
  const payload = { title: 't', body: 'b' };
  const result = await createIssue(fetchImpl, env, payload);

  assert.deepEqual(result, { ok: true, url: 'https://github.com/acme/theme/issues/42' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.github.com/repos/acme/theme/issues');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok_123');
  assert.equal(calls[0].init.headers.Accept, 'application/vnd.github+json');
  assert.equal(calls[0].init.headers['X-GitHub-Api-Version'], '2022-11-28');
  assert.equal(calls[0].init.headers['User-Agent'], 'fallback-sentinel');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].init.body, JSON.stringify(payload));
});

test('createIssue reports failure detail on a non-201 status', async () => {
  const fetchImpl = async () => fakeResponse({ status: 422, text: 'Validation Failed: title is required and stuff'.repeat(20) });
  const result = await createIssue(fetchImpl, { SENTINEL_REPORT_REPO: 'acme/theme', SENTINEL_GITHUB_TOKEN: 'tok' }, { title: 't', body: 'b' });
  assert.equal(result.ok, false);
  assert.ok(result.detail.includes('422'));
  assert.ok(result.detail.length < 400);
});

test('createIssue catches a thrown fetch error', async () => {
  const fetchImpl = async () => {
    throw new Error('network unreachable');
  };
  const result = await createIssue(fetchImpl, { SENTINEL_REPORT_REPO: 'acme/theme', SENTINEL_GITHUB_TOKEN: 'tok' }, { title: 't', body: 'b' });
  assert.equal(result.ok, false);
  assert.ok(result.detail.includes('network unreachable'));
});

const REPORTING_ENV = { SENTINEL_REPORT_REPO: 'acme/theme', SENTINEL_GITHUB_TOKEN: 'tok_123' };
const TODAY = '2026-07-07';

test('drift day + configured posts one issue and returns 1', async () => {
  const t = fakeDeps({
    env: REPORTING_ENV,
    responses: [
      { code: 0, stdout: LIST_ONE, stderr: '' },
      { code: 0, stdout: DRIFT_DIFF, stderr: 'Products\n  Updated: 1' },
      { code: 0, stdout: '', stderr: '' },
    ],
  });
  const fetchCalls = [];
  const fetchImpl = async (url, init) => {
    fetchCalls.push({ url, init });
    return fakeResponse({ status: 201, htmlUrl: 'https://github.com/acme/theme/issues/7' });
  };
  const code = await runSentinelWithReporting({ ...t.deps, fetchImpl, today: TODAY });
  assert.equal(code, 1);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'https://api.github.com/repos/acme/theme/issues');
  assert.equal(fetchCalls[0].init.headers.Authorization, 'Bearer tok_123');
  const payload = JSON.parse(fetchCalls[0].init.body);
  assert.ok(payload.title.includes('drift report'));
  assert.ok(payload.body.includes('=== DRIFT REPORT'));
  assert.ok(t.lines.some((l) => l.includes('report filed:')));
});

test('drift day + unconfigured does not call fetch and still returns 1', async () => {
  const t = fakeDeps({
    responses: [
      { code: 0, stdout: LIST_ONE, stderr: '' },
      { code: 0, stdout: DRIFT_DIFF, stderr: 'Products\n  Updated: 1' },
      { code: 0, stdout: '', stderr: '' },
    ],
  });
  let fetchCalled = false;
  const fetchImpl = async () => {
    fetchCalled = true;
    return fakeResponse({ status: 201, htmlUrl: 'x' });
  };
  const code = await runSentinelWithReporting({ ...t.deps, fetchImpl, today: TODAY });
  assert.equal(code, 1);
  assert.equal(fetchCalled, false);
});

test('quiet day + configured does not call fetch and returns 0', async () => {
  const t = fakeDeps({
    env: REPORTING_ENV,
    responses: [
      { code: 0, stdout: LIST_ONE, stderr: '' },
      { code: 0, stdout: QUIET_DIFF, stderr: '' },
      { code: 0, stdout: '', stderr: '' },
    ],
  });
  let fetchCalled = false;
  const fetchImpl = async () => {
    fetchCalled = true;
    return fakeResponse({ status: 201, htmlUrl: 'x' });
  };
  const code = await runSentinelWithReporting({ ...t.deps, fetchImpl, today: TODAY });
  assert.equal(code, 0);
  assert.equal(fetchCalled, false);
});

test('failure day (code 2) + configured posts a sentinel-failure issue', async () => {
  const t = fakeDeps({
    env: REPORTING_ENV,
    responses: [{ code: 2, stdout: '', stderr: 'fallback: Shopify GraphQL error' }],
  });
  const fetchCalls = [];
  const fetchImpl = async (url, init) => {
    fetchCalls.push({ url, init });
    return fakeResponse({ status: 201, htmlUrl: 'https://github.com/acme/theme/issues/8' });
  };
  const code = await runSentinelWithReporting({ ...t.deps, fetchImpl, today: TODAY });
  assert.equal(code, 2);
  assert.equal(fetchCalls.length, 1);
  const payload = JSON.parse(fetchCalls[0].init.body);
  assert.ok(payload.title.includes('sentinel failure'));
});

test('issue POST returning 422 turns the run into a failure and logs the report failure', async () => {
  const t = fakeDeps({
    env: REPORTING_ENV,
    responses: [
      { code: 0, stdout: LIST_ONE, stderr: '' },
      { code: 0, stdout: DRIFT_DIFF, stderr: 'Products\n  Updated: 1' },
      { code: 0, stdout: '', stderr: '' },
    ],
  });
  const fetchImpl = async () => fakeResponse({ status: 422, text: 'Validation Failed' });
  const code = await runSentinelWithReporting({ ...t.deps, fetchImpl, today: TODAY });
  assert.equal(code, 2);
  assert.ok(t.lines.some((l) => l.includes('SENTINEL FAILURE — report')));
  assert.ok(t.lines.some((l) => l.includes('422')));
});
