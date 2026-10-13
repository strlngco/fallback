import { describe, expect, it, vi } from 'vitest';
import { paginate } from '../pagination';

describe('paginate', () => {
  it('yields nodes from a single page when there is no next page', async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      nodes: [1, 2, 3],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
    const collected: number[] = [];
    for await (const n of paginate<number>(fetchPage)) collected.push(n);
    expect(collected).toEqual([1, 2, 3]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(null);
  });

  it('passes the previous endCursor to the next call until hasNextPage is false', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ nodes: [1], pageInfo: { hasNextPage: true, endCursor: 'c1' } })
      .mockResolvedValueOnce({ nodes: [2], pageInfo: { hasNextPage: true, endCursor: 'c2' } })
      .mockResolvedValueOnce({ nodes: [3], pageInfo: { hasNextPage: false, endCursor: 'c3' } });
    const collected: number[] = [];
    for await (const n of paginate<number>(fetchPage)) collected.push(n);
    expect(collected).toEqual([1, 2, 3]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage).toHaveBeenNthCalledWith(1, null);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 'c1');
    expect(fetchPage).toHaveBeenNthCalledWith(3, 'c2');
  });

  it('terminates immediately when the first page reports no next page', async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: 'unused' },
    });
    const collected: number[] = [];
    for await (const n of paginate<number>(fetchPage)) collected.push(n);
    expect(collected).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('terminates if hasNextPage is true but endCursor is null', async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      nodes: [1],
      pageInfo: { hasNextPage: true, endCursor: null },
    });
    const collected: number[] = [];
    for await (const n of paginate<number>(fetchPage)) collected.push(n);
    expect(collected).toEqual([1]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
