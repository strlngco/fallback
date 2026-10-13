import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Fails if private names, local paths, or binary images appear in tracked
// files, in commit metadata, or in the published tarball. The private names
// themselves cannot live in this public file, so they come from the
// LEAK_PATTERNS environment variable (a CI secret) or from
// .claude/leak-patterns.txt (gitignored), one case-insensitive regex per line.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PATTERNS_FILE = join(ROOT, '.claude', 'leak-patterns.txt');

const GENERIC_PATTERNS = [
  /\/Users\/[A-Za-z0-9_-][A-Za-z0-9._-]*\//,
  /\/home\/(?!runner\/)[A-Za-z0-9_-][A-Za-z0-9._-]*\//,
  /[A-Z]:\\Users\\[A-Za-z0-9_-][A-Za-z0-9._-]*\\/i,
];

const BINARY_IMAGE = /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|pdf|psd)$/i;

function loadPrivatePatterns() {
  const raw =
    process.env.LEAK_PATTERNS ?? (existsSync(PATTERNS_FILE) ? readFileSync(PATTERNS_FILE, 'utf-8') : '');
  return raw
    .split(/\r?\n|,/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((source) => new RegExp(source, 'i'));
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 });
}

function scanText(label, text, patterns, findings) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const pattern of patterns) {
      if (pattern.test(lines[i])) {
        findings.push(`${label}:${i + 1} matches ${pattern}`);
      }
    }
  }
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const privatePatterns = loadPrivatePatterns();
if (privatePatterns.length === 0) {
  console.error(
    'leak-check: no private patterns configured. Set LEAK_PATTERNS or create .claude/leak-patterns.txt.',
  );
  process.exit(2);
}
const patterns = [...privatePatterns, ...GENERIC_PATTERNS];
const findings = [];

const tracked = git(['ls-files', '-z']).split('\0').filter((path) => path !== '');
for (const path of tracked) {
  scanText(`path ${path}`, path, privatePatterns, findings);
  if (BINARY_IMAGE.test(path)) {
    findings.push(`file ${path} is a binary image; text in images cannot be checked`);
    continue;
  }
  if (path === 'scripts/leak-check.mjs') continue;
  const full = join(ROOT, path);
  if (!existsSync(full)) continue;
  scanText(path, readFileSync(full, 'utf-8'), patterns, findings);
}

const history = git(['log', '--all', '--format=%H%n%an <%ae>%n%cn <%ce>%n%B%n']);
scanText('git history', history, patterns, findings);

const work = mkdtempSync(join(tmpdir(), 'fallback-leak-'));
try {
  try {
    execFileSync('pnpm', ['pack', '--pack-destination', work], {
      cwd: join(ROOT, 'packages', 'cli'),
      stdio: 'ignore',
      // pnpm is a .cmd shim on Windows, which Node only launches through a shell.
      shell: process.platform === 'win32',
    });
  } catch {
    console.error('leak-check: pnpm pack failed. Run pnpm install and pnpm build first.');
    process.exit(2);
  }
  const tarball = readdirSync(work).find((name) => name.endsWith('.tgz'));
  execFileSync('tar', ['-xzf', join(work, tarball), '-C', work]);
  // An unbuilt package would pack without dist/ and pass trivially.
  if (!existsSync(join(work, 'package', 'dist', 'index.js'))) {
    console.error('leak-check: the packed CLI has no dist/index.js. Run pnpm build first.');
    process.exit(2);
  }
  for (const file of walk(join(work, 'package'))) {
    scanText(`tarball ${relative(work, file)}`, readFileSync(file, 'utf-8'), patterns, findings);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (findings.length > 0) {
  console.error(`leak-check failed (${findings.length}):`);
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}
console.error(`leak-check passed (${tracked.length} files, history, tarball)`);
