import { describe, expect, it } from 'vitest';
import { InvalidOptionError } from '../../env';
import { OutputWriter } from '../writer';

function sink() {
  let buf = '';
  return { write: (s: string) => (buf += s), get text() { return buf; } };
}

describe('OutputWriter', () => {
  it('json() writes pretty JSON + newline to stdout only', () => {
    const out = sink();
    const err = sink();
    new OutputWriter({ stdout: out, stderr: err, json: true }).json({ a: 1 });
    expect(out.text).toBe(JSON.stringify({ a: 1 }, null, 2) + '\n');
    expect(err.text).toBe('');
  });

  it('human() writes lines joined by newline + trailing newline to stderr only', () => {
    const out = sink();
    const err = sink();
    new OutputWriter({ stdout: out, stderr: err, json: false }).human(['a', 'b']);
    expect(err.text).toBe('a\nb\n');
    expect(out.text).toBe('');
  });

  it('error() writes the json envelope to stderr and returns the exit code', () => {
    const out = sink();
    const err = sink();
    const code = new OutputWriter({ stdout: out, stderr: err, json: true }).error(
      new InvalidOptionError('bad'),
    );
    expect(code).toBe(1);
    expect(err.text).toBe(JSON.stringify({ error: 'bad', exitCode: 1 }) + '\n');
    expect(out.text).toBe('');
  });
});
