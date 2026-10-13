export type OutputMode = 'json' | 'interactive' | 'plain';

export function outputMode(opts: {
  json: boolean;
  quiet: boolean;
  stdout: { isTTY?: boolean };
  stdin: { isTTY?: boolean };
}): OutputMode {
  if (opts.json) return 'json';
  const tty = Boolean(opts.stdout.isTTY && opts.stdin.isTTY);
  return tty && !opts.quiet ? 'interactive' : 'plain';
}
