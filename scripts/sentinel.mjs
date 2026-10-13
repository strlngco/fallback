import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

export const DEFAULT_SCOPE = 'products,collections,metafields,metaobjects';

// A manifest-less partial snapshot (e.g. from an interrupted capture with an
// older CLI, or any future crash mid-write) must degrade to re-baselining
// rather than fail the diff daily; list --json marks such entries broken.
// diff refuses to compare resources its baseline never captured, so after
// SENTINEL_SCOPE widens, only a snapshot covering the new scope can serve as one.
const SCOPE_MANIFEST_KEYS = {
  products: 'products',
  collections: 'collections',
  metafields: 'metafields',
  'inventory-levels': 'inventoryLevels',
  metaobjects: 'metaobjects',
};

function coversScope(entry, scope) {
  return scope
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .every((part) => entry.scope?.[SCOPE_MANIFEST_KEYS[part] ?? part] === true);
}

export function latestSnapshotId(entries, shop, scope) {
  const ids = entries
    .filter((e) => e.shop === shop && e.broken !== true)
    .filter((e) => scope === undefined || coversScope(e, scope))
    .map((e) => e.snapshotId);
  if (ids.length === 0) return null;
  // Snapshot ids (YYYY-MM-DDTHH-MM-SSZ) sort chronologically as strings.
  return ids.sort().at(-1);
}

export function evaluateDrift(diffJson) {
  const summary = [];
  for (const [key, r] of Object.entries(diffJson.resources ?? {})) {
    const created = r.created.length;
    const updated = r.updated.length;
    const deleted = r.deleted.length;
    if (created + updated + deleted > 0) {
      summary.push(`${key}: +${created} ~${updated} -${deleted}`);
    }
  }
  return { drifted: summary.length > 0, summary };
}

export async function runSentinel({ runCli, env, log }) {
  const shop = (env.SHOPIFY_SHOP_DOMAIN ?? '').trim();
  if (shop === '') {
    log('=== SENTINEL FAILURE — configuration ===');
    log('SHOPIFY_SHOP_DOMAIN is not set.');
    return 2;
  }
  const scope = (env.SENTINEL_SCOPE ?? '').trim() || DEFAULT_SCOPE;
  const baseDirArgs = (env.FALLBACK_BASE_DIR ?? '').trim()
    ? ['--base-dir', env.FALLBACK_BASE_DIR.trim()]
    : [];

  const cli = async (args) => {
    try {
      return await runCli([...args, ...baseDirArgs]);
    } catch (err) {
      return { code: 2, stdout: '', stderr: err instanceof Error ? err.message : String(err) };
    }
  };

  const fail = (stage, detail) => {
    log(`=== SENTINEL FAILURE — ${stage} ===`);
    if (detail.trim() !== '') log(detail.trim());
    return 2;
  };

  const list = await cli(['list', '--json']);
  if (list.code !== 0) return fail('list', list.stderr);
  let latest;
  let latestAnyScope;
  try {
    const entries = JSON.parse(list.stdout);
    latest = latestSnapshotId(entries, shop, scope);
    latestAnyScope = latestSnapshotId(entries, shop);
  } catch {
    return fail('list', 'list --json produced unparseable output');
  }

  if (latest === null) {
    const snap = await cli(['snapshot', '--scope', scope]);
    if (snap.code !== 0) return fail('snapshot', snap.stderr);
    log(
      latestAnyScope === null
        ? `=== FIRST RUN — baseline captured — ${shop} ===`
        : `=== BASELINE RESET — no snapshot covers scope ${scope}; new baseline captured — ${shop} ===`,
    );
    if (snap.stderr.trim() !== '') log(snap.stderr.trim());
    return 0;
  }

  // One diff call yields both the JSON (drift detection) and the human report:
  // --with-report renders the operator-facing text to stderr from the same
  // fetch, so the log matches `fallback diff` without a second live round-trip
  // (and without a second failure surface that could swallow the real error).
  const diffRun = await cli(['diff', latest, '--scope', scope, '--json', '--with-report']);
  if (diffRun.code !== 0) return fail('diff', diffRun.stderr);
  let drift;
  try {
    drift = evaluateDrift(JSON.parse(diffRun.stdout));
  } catch {
    return fail('diff', 'diff --json produced unparseable output');
  }

  const humanReport = drift.drifted ? diffRun.stderr.trim() : '';

  const snap = await cli(['snapshot', '--scope', scope]);

  if (drift.drifted) {
    log(`=== DRIFT REPORT — ${shop} — ${latest} ===`);
    for (const line of drift.summary) log(line);
    log('');
    if (humanReport !== '') log(humanReport);
    log('');
    // fallback isn't on PATH in the worker shell, and a deep dive against a
    // custom snapshot location needs the same --base-dir the run itself used.
    const deepDiveArgs = ['node packages/cli/dist/index.js diff', latest, '--scope', scope, '--json', ...baseDirArgs];
    log(`deep dive: ${deepDiveArgs.join(' ')}`);
    log('rollback: see docs/scheduled-sentinel.md');
  }

  // A missing tomorrow-baseline is worse than a missed report, so snapshot
  // failure wins the exit code even on a drifted day (the report is printed above).
  if (snap.code !== 0) return fail('snapshot', snap.stderr);

  if (!drift.drifted) {
    log(`=== ALL QUIET — ${shop} ===`);
    return 0;
  }
  return 1;
}

const GITHUB_BODY_LIMIT = 65536;
const TRUNCATION_MARKER = '(report truncated; full log in Render)';

export function buildIssuePayload(code, shop, isoDate, lines) {
  const title =
    code === 1
      ? `Fallback drift report — ${shop} — ${isoDate}`
      : `Fallback sentinel failure — ${shop} — ${isoDate}`;
  return { title, body: fenceLogLines(lines) };
}

function fenceLogLines(lines) {
  const full = '```\n' + lines.join('\n') + '\n```';
  if (full.length <= GITHUB_BODY_LIMIT) return full;

  // Truncate from the TOP so the deep-dive/rollback pointers at the end of the
  // log survive; a partial leading line is dropped rather than kept broken.
  const prefix = '```\n' + TRUNCATION_MARKER + '\n';
  const suffix = '\n```';
  const budget = GITHUB_BODY_LIMIT - prefix.length - suffix.length;

  let kept = lines.join('\n');
  if (kept.length > budget) {
    kept = kept.slice(kept.length - budget);
    const firstNewline = kept.indexOf('\n');
    if (firstNewline !== -1) kept = kept.slice(firstNewline + 1);
  }
  return prefix + kept + suffix;
}

export async function createIssue(fetchImpl, env, payload) {
  const url = `https://api.github.com/repos/${env.SENTINEL_REPORT_REPO}/issues`;
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SENTINEL_GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'fallback-sentinel',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (response.status === 201) {
      const json = await response.json();
      return { ok: true, url: json.html_url };
    }
    const text = await response.text();
    return { ok: false, detail: `HTTP ${response.status}: ${text.slice(0, 300)}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export async function runSentinelWithReporting({ runCli, env, log, fetchImpl, today }) {
  const bufferedLines = [];
  const code = await runSentinel({
    runCli,
    env,
    log: (line) => {
      bufferedLines.push(line);
      log(line);
    },
  });
  if (code === 0) return 0;

  const reportRepo = (env.SENTINEL_REPORT_REPO ?? '').trim();
  const githubToken = (env.SENTINEL_GITHUB_TOKEN ?? '').trim();
  if (reportRepo === '' || githubToken === '') return code;

  const shop = (env.SHOPIFY_SHOP_DOMAIN ?? '').trim();
  const payload = buildIssuePayload(code, shop, today, bufferedLines);
  const result = await createIssue(fetchImpl, env, payload);
  if (result.ok) {
    log(`report filed: ${result.url}`);
    return code;
  }

  log('=== SENTINEL FAILURE — report ===');
  log(result.detail);
  return 2;
}

const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'cli', 'dist', 'index.js');
const execFileAsync = promisify(execFile);

async function realRunCli(args) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_PATH, ...args], {
      maxBuffer: 64 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return {
      code: typeof err.code === 'number' ? err.code : 2,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? String(err),
    };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = await runSentinelWithReporting({
    runCli: realRunCli,
    env: process.env,
    log: (line) => console.log(line),
    fetchImpl: globalThis.fetch,
    today: new Date().toISOString().slice(0, 10),
  });
  process.exit(code);
}
