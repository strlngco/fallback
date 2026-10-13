import { join } from 'node:path';

export function defaultBaseDir(homeDir: string): string {
  return join(homeDir, '.fallback', 'snapshots');
}

export function isENOENT(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'ENOENT'
  );
}
