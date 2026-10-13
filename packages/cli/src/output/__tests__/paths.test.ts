import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultBaseDir, isENOENT } from '../paths';

describe('defaultBaseDir', () => {
  it('joins homeDir with .fallback/snapshots', () => {
    expect(defaultBaseDir('/home/u')).toBe(join('/home/u', '.fallback', 'snapshots'));
  });
});

describe('isENOENT', () => {
  it('is true for an ENOENT-coded error', () => {
    expect(isENOENT({ code: 'ENOENT' })).toBe(true);
  });
  it('is false for other errors and non-objects', () => {
    expect(isENOENT({ code: 'EACCES' })).toBe(false);
    expect(isENOENT(new Error('x'))).toBe(false);
    expect(isENOENT(null)).toBe(false);
    expect(isENOENT('ENOENT')).toBe(false);
  });
});
