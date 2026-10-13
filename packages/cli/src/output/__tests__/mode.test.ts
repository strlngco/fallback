import { describe, expect, it } from 'vitest';
import { outputMode } from '../mode';

const tty = { isTTY: true };
const notTty = { isTTY: false };

describe('outputMode', () => {
  it('returns json whenever json is set, regardless of tty/quiet', () => {
    expect(outputMode({ json: true, quiet: false, stdout: tty, stdin: tty })).toBe('json');
    expect(outputMode({ json: true, quiet: true, stdout: notTty, stdin: notTty })).toBe('json');
  });

  it('returns interactive only when both streams are a TTY and not quiet', () => {
    expect(outputMode({ json: false, quiet: false, stdout: tty, stdin: tty })).toBe('interactive');
  });

  it('returns plain when quiet, even on a TTY', () => {
    expect(outputMode({ json: false, quiet: true, stdout: tty, stdin: tty })).toBe('plain');
  });

  it('returns plain when either stream is not a TTY (piped)', () => {
    expect(outputMode({ json: false, quiet: false, stdout: tty, stdin: notTty })).toBe('plain');
    expect(outputMode({ json: false, quiet: false, stdout: notTty, stdin: tty })).toBe('plain');
  });

  it('treats a missing isTTY as not a TTY', () => {
    expect(outputMode({ json: false, quiet: false, stdout: {}, stdin: {} })).toBe('plain');
  });
});
