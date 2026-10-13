import { writeError } from './errors';

export interface WritableLike {
  write(s: string): unknown;
}

export class OutputWriter {
  private readonly stdout: WritableLike;
  private readonly stderr: WritableLike;
  private readonly isJson: boolean;

  constructor(opts: { stdout: WritableLike; stderr: WritableLike; json: boolean }) {
    this.stdout = opts.stdout;
    this.stderr = opts.stderr;
    this.isJson = opts.json;
  }

  json(data: unknown): void {
    this.stdout.write(JSON.stringify(data, null, 2) + '\n');
  }

  human(lines: string[]): void {
    this.stderr.write(lines.join('\n') + '\n');
  }

  error(err: unknown): number {
    return writeError(this.stderr, err, this.isJson);
  }
}
