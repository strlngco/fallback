import { describe, expect, it } from 'vitest';
import { diffResources } from '../resource-diff';

interface Item {
  id: string;
  value: number;
}

async function* asAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

const getId = (item: Item): string => item.id;

describe('diffResources', () => {
  it('reports all current as created when the snapshot is empty', async () => {
    const result = await diffResources<Item>({
      snapshot: asAsyncIterable([]),
      current: asAsyncIterable([
        { id: 'a', value: 1 },
        { id: 'b', value: 2 },
      ]),
      getId,
    });
    expect(result.created).toHaveLength(2);
    expect(result.updated).toEqual([]);
    expect(result.deleted).toEqual([]);
    expect(result.unchanged).toBe(0);
    expect(result.snapshotCount).toBe(0);
    expect(result.currentCount).toBe(2);
  });

  it('reports all snapshot as deleted when current is empty', async () => {
    const result = await diffResources<Item>({
      snapshot: asAsyncIterable([
        { id: 'a', value: 1 },
        { id: 'b', value: 2 },
      ]),
      current: asAsyncIterable([]),
      getId,
    });
    expect(result.created).toEqual([]);
    expect(result.updated).toEqual([]);
    expect(result.deleted).toHaveLength(2);
    expect(result.unchanged).toBe(0);
    expect(result.snapshotCount).toBe(2);
    expect(result.currentCount).toBe(0);
  });

  it('reports unchanged when records match by id and content', async () => {
    const records = [
      { id: 'a', value: 1 },
      { id: 'b', value: 2 },
    ];
    const result = await diffResources<Item>({
      snapshot: asAsyncIterable(records),
      current: asAsyncIterable(records.map((r) => ({ ...r }))),
      getId,
    });
    expect(result.unchanged).toBe(2);
    expect(result.updated).toEqual([]);
    expect(result.created).toEqual([]);
    expect(result.deleted).toEqual([]);
  });

  it('reports updated with the changes list when content differs', async () => {
    const result = await diffResources<Item>({
      snapshot: asAsyncIterable([{ id: 'a', value: 1 }]),
      current: asAsyncIterable([{ id: 'a', value: 2 }]),
      getId,
    });
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0]?.id).toBe('a');
    expect(result.updated[0]?.changes).toEqual([
      { path: 'value', before: 1, after: 2 },
    ]);
    expect(result.unchanged).toBe(0);
  });

  it('handles a mixed diff across all categories', async () => {
    const result = await diffResources<Item>({
      snapshot: asAsyncIterable([
        { id: 'unchanged', value: 1 },
        { id: 'updated', value: 1 },
        { id: 'deleted', value: 1 },
      ]),
      current: asAsyncIterable([
        { id: 'unchanged', value: 1 },
        { id: 'updated', value: 9 },
        { id: 'created', value: 1 },
      ]),
      getId,
    });
    expect(result.created.map((r) => r.id)).toEqual(['created']);
    expect(result.updated.map((u) => u.id)).toEqual(['updated']);
    expect(result.deleted.map((r) => r.id)).toEqual(['deleted']);
    expect(result.unchanged).toBe(1);
    expect(result.snapshotCount).toBe(3);
    expect(result.currentCount).toBe(3);
  });

  it('handles a large iterable without materializing current', async () => {
    const size = 1000;
    const snapshot = Array.from({ length: size }, (_, i) => ({ id: `r${i}`, value: i }));
    const current = snapshot.map((r) => ({ ...r, value: r.value + 1 }));
    const result = await diffResources<Item>({
      snapshot: asAsyncIterable(snapshot),
      current: asAsyncIterable(current),
      getId,
    });
    expect(result.updated).toHaveLength(size);
    expect(result.snapshotCount).toBe(size);
    expect(result.currentCount).toBe(size);
  });

  it('propagates an error thrown by the snapshot iterable', async () => {
    async function* failingSnapshot(): AsyncIterable<Item> {
      yield { id: 'a', value: 1 };
      throw new Error('snapshot read failed');
    }
    await expect(
      diffResources<Item>({
        snapshot: failingSnapshot(),
        current: asAsyncIterable([]),
        getId,
      }),
    ).rejects.toThrow('snapshot read failed');
  });

  it('propagates an error thrown by the current iterable', async () => {
    async function* failingCurrent(): AsyncIterable<Item> {
      yield { id: 'a', value: 1 };
      throw new Error('fetcher failed mid-stream');
    }
    await expect(
      diffResources<Item>({
        snapshot: asAsyncIterable([{ id: 'a', value: 1 }]),
        current: failingCurrent(),
        getId,
      }),
    ).rejects.toThrow('fetcher failed mid-stream');
  });

  it('accepts plain Iterable inputs in addition to AsyncIterable', async () => {
    const result = await diffResources<Item>({
      snapshot: [{ id: 'a', value: 1 }],
      current: [{ id: 'a', value: 2 }],
      getId,
    });
    expect(result.updated).toHaveLength(1);
  });
});
