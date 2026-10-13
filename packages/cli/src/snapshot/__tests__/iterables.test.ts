import { describe, expect, it } from 'vitest';
import { concatIterables, teeKeys } from '../iterables';

async function* toAsync<T>(items: T[]): AsyncIterable<T> {
  for (const i of items) yield i;
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

describe('iterables', () => {
  it('concatenates sources in order', async () => {
    expect(await collect(concatIterables(toAsync([1, 2]), toAsync([3])))).toEqual([1, 2, 3]);
  });

  it('tees keys while passing items through', async () => {
    const keys: string[] = [];
    const out = await collect(teeKeys(toAsync([{ id: 'a' }, { id: 'b' }]), (i) => i.id, keys));
    expect(out).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(keys).toEqual(['a', 'b']);
  });
});
