import { copyFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// npm shows the README from the published package directory, so the root
// README and LICENSE are copied into the CLI package while it is packed and
// removed afterwards. A Node script rather than cp/rm so packing also works
// on Windows.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_DIR = join(ROOT, 'packages', 'cli');
const FILES = ['README.md', 'LICENSE'];

const action = process.argv[2];
if (action === 'copy') {
  for (const file of FILES) copyFileSync(join(ROOT, file), join(CLI_DIR, file));
} else if (action === 'clean') {
  for (const file of FILES) rmSync(join(CLI_DIR, file), { force: true });
} else {
  console.error('usage: node scripts/package-docs.mjs copy|clean');
  process.exit(1);
}
