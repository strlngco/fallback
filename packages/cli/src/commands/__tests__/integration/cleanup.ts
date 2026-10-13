import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Path to the built CLI. Integration tests require `pnpm build` to have been
// run first — they spawn the actual compiled binary to exercise the same code
// path real users hit, including the bundled output. Importing internal
// functions instead would let internal-only regressions slip through.
//
// Source layout (depth 5 below packages/cli/): src/commands/__tests__/integration/
// Build output (depth 1):                       dist/
const CLI_PATH = fileURLToPath(
  new URL('../../../../dist/index.js', import.meta.url),
);

const TEMP_PREFIX = 'fallback-integration-test-';

// Mirrors packages/cli/src/env.ts loading: ~/.fallback/.env, then <cwd>/.env,
// then process.env (highest wins). Cached once at module load so each runCLI()
// spawn doesn't re-read the files. Inline parser instead of a dotenv dep —
// the production CLI carries its own parser; this is the test-harness boundary
// mirroring it.
const MERGED_ENV: Record<string, string> = buildMergedEnv();

const REQUIRED_INTEGRATION_VARS = [
  'SHOPIFY_SHOP_DOMAIN',
  'SHOPIFY_CLIENT_ID',
  'SHOPIFY_CLIENT_SECRET',
] as const;

export async function createTempBaseDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), TEMP_PREFIX));
}

export async function cleanupTempBaseDir(path: string | undefined): Promise<void> {
  // No-op when path is undefined — happens if the env-check beforeAll throws
  // before the temp-dir beforeAll runs. Letting rm() see undefined throws a
  // TypeError that buries the real assertIntegrationEnv message.
  if (path === undefined || path.length === 0) return;
  await rm(path, { recursive: true, force: true });
}

export function assertIntegrationEnv(): void {
  const missing = REQUIRED_INTEGRATION_VARS.filter((key) => {
    const value = MERGED_ENV[key];
    return value === undefined || value.length === 0;
  });
  if (missing.length === 0) return;
  throw new Error(
    'Integration tests require SHOPIFY_SHOP_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET. ' +
      'Set them in environment, .env, or ~/.fallback/.env.',
  );
}

export interface CLIResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function runCLI(args: string[]): Promise<CLIResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [CLI_PATH, ...args], {
      env: MERGED_ENV,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    child.once('error', (err) => reject(err));
    child.once('close', (code) => {
      resolve({ exitCode: code ?? 0, stdout, stderr });
    });
  });
}

function buildMergedEnv(): Record<string, string> {
  const merged: Record<string, string> = {};
  mergeFile(merged, join(homedir(), '.fallback', '.env'));
  mergeFile(merged, join(process.cwd(), '.env'));
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

function mergeFile(target: Record<string, string>, path: string): void {
  let content: string;
  try {
    content = readFileSync(path, 'utf-8');
  } catch {
    return;
  }
  Object.assign(target, parseEnvFileContent(content));
}

function parseEnvFileContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (key.length === 0) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}
