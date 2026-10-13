import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Installs the packed CLI tarball the way a user would, outside the
// workspace, so nothing resolves through pnpm's symlinks. Tests never see
// what npm actually ships; this does.

const CLI_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'cli');
const failures = [];

// Run from prepublishOnly under `publish --dry-run`, npm exports
// npm_config_dry_run, which would make the nested pack and install no-ops.
const childEnv = { ...process.env };
delete childEnv.npm_config_dry_run;

// On Windows, pnpm, npm, and installed bins are .cmd shims, which Node only
// launches through a shell.
const WINDOWS = process.platform === 'win32';
const shellOption = { shell: WINDOWS };

function check(condition, message) {
  if (!condition) failures.push(message);
}

// Only what a process needs to start, so credentials or SHOPIFY_* variables in
// the caller's environment cannot leak into the checks. Windows also needs
// SystemRoot and the shell's own variables to launch .cmd shims.
function minimalEnv() {
  const keep = ['PATH', 'Path', 'SystemRoot', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP'];
  return Object.fromEntries(keep.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
}

const work = mkdtempSync(join(tmpdir(), 'fallback-smoke-'));
try {
  execFileSync('pnpm', ['pack', '--pack-destination', work], {
    cwd: CLI_DIR,
    stdio: 'ignore',
    env: childEnv,
    ...shellOption,
  });
  const tarball = readdirSync(work).find((name) => name.endsWith('.tgz'));
  if (!tarball) throw new Error('pnpm pack produced no tarball');

  const unpacked = join(work, 'unpacked');
  mkdirSync(unpacked);
  execFileSync('tar', ['-xzf', join(work, tarball), '-C', unpacked]);
  const pkg = JSON.parse(readFileSync(join(unpacked, 'package', 'package.json'), 'utf-8'));
  const shipped = readdirSync(join(unpacked, 'package'));

  check(pkg.name === '@strlngco/fallback', `package name is ${pkg.name}`);
  check(shipped.includes('README.md'), 'tarball has no README.md');
  check(shipped.includes('LICENSE'), 'tarball has no LICENSE');
  check(!existsSync(join(unpacked, 'package', 'dist', 'index.js.map')), 'tarball ships a source map');
  for (const [name, range] of Object.entries(pkg.dependencies ?? {})) {
    check(!name.startsWith('@strlngco/fallback-'), `runtime dependency on workspace package ${name}`);
    check(!String(range).startsWith('workspace:'), `unresolved workspace range for ${name}`);
  }

  const prefix = join(work, 'prefix');
  execFileSync('npm', ['install', '--prefix', prefix, '--no-audit', '--no-fund', join(work, tarball)], {
    stdio: 'ignore',
    env: childEnv,
    ...shellOption,
  });
  const bin = join(prefix, 'node_modules', '.bin', WINDOWS ? 'fallback.cmd' : 'fallback');
  const home = mkdtempSync(join(work, 'home-'));
  const run = (args) =>
    spawnSync(bin, args, {
      cwd: home,
      encoding: 'utf-8',
      env: { ...minimalEnv(), HOME: home, USERPROFILE: home },
      ...shellOption,
    });

  const version = run(['--version']);
  check(version.status === 0, `--version exited ${version.status}: ${version.stderr.trim()}`);
  check(version.stdout.trim() === pkg.version, `--version printed "${version.stdout.trim()}", expected ${pkg.version}`);

  const help = run(['--help']);
  check(help.status === 0, `--help exited ${help.status}`);

  const list = run(['list', '--json']);
  check(list.status === 0, `list --json exited ${list.status}: ${list.stderr.trim()}`);
  check(list.stdout.trim() === '[]', `list --json printed "${list.stdout.trim()}"`);

  const missingEnv = run(['snapshot']);
  check(missingEnv.status === 1, `snapshot without credentials exited ${missingEnv.status}, expected 1`);
} catch (err) {
  failures.push(err instanceof Error ? err.message : String(err));
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error('smoke-pack failed:');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.error('smoke-pack passed');
