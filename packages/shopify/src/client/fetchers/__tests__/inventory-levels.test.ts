import { describe, expect, it, vi } from 'vitest';
import { type Requester } from '../../client';
import { fetchInventoryLevels } from '../inventory-levels';

function makeLevelNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gid://shopify/InventoryLevel/500',
    updatedAt: '2026-05-01T00:00:00Z',
    item: { id: 'gid://shopify/InventoryItem/1000' },
    quantities: [
      { name: 'available', quantity: 12 },
      { name: 'on_hand', quantity: 12 },
    ],
    ...overrides,
  };
}

function locationsPage(
  nodes: Array<{ id: string; name: string }>,
  pageInfo: { hasNextPage: boolean; endCursor: string | null },
) {
  return {
    locations: {
      edges: nodes.map((node) => ({ node })),
      pageInfo,
    },
  };
}

function levelsPage(
  nodes: Array<Record<string, unknown>>,
  pageInfo: { hasNextPage: boolean; endCursor: string | null },
) {
  return {
    location: {
      inventoryLevels: {
        edges: nodes.map((node) => ({ node })),
        pageInfo,
      },
    },
  };
}

function fakeClient() {
  const request = vi.fn();
  return { request, client: { request } as unknown as Requester };
}

describe('fetchInventoryLevels', () => {
  it('paginates locations and inventory levels per location, attaching the location to each level', async () => {
    const { request, client } = fakeClient();
    request
      .mockResolvedValueOnce(
        locationsPage(
          [
            { id: 'gid://shopify/Location/1', name: 'Main Warehouse' },
            { id: 'gid://shopify/Location/2', name: 'Outlet' },
          ],
          { hasNextPage: false, endCursor: null },
        ),
      )
      .mockResolvedValueOnce(
        levelsPage(
          [makeLevelNode({ id: 'gid://shopify/InventoryLevel/500' })],
          { hasNextPage: true, endCursor: 'l1' },
        ),
      )
      .mockResolvedValueOnce(
        levelsPage(
          [makeLevelNode({ id: 'gid://shopify/InventoryLevel/501' })],
          { hasNextPage: false, endCursor: null },
        ),
      )
      .mockResolvedValueOnce(
        levelsPage(
          [makeLevelNode({ id: 'gid://shopify/InventoryLevel/600' })],
          { hasNextPage: false, endCursor: null },
        ),
      );

    const collected = [];
    for await (const level of fetchInventoryLevels(client)) collected.push(level);

    expect(collected).toHaveLength(3);
    expect(collected[0]?.location.name).toBe('Main Warehouse');
    expect(collected[1]?.location.name).toBe('Main Warehouse');
    expect(collected[2]?.location.name).toBe('Outlet');

    expect(request).toHaveBeenCalledTimes(4);
    expect(request).toHaveBeenNthCalledWith(2, expect.any(String), {
      locationId: 'gid://shopify/Location/1',
      cursor: null,
    });
    expect(request).toHaveBeenNthCalledWith(3, expect.any(String), {
      locationId: 'gid://shopify/Location/1',
      cursor: 'l1',
    });
    expect(request).toHaveBeenNthCalledWith(4, expect.any(String), {
      locationId: 'gid://shopify/Location/2',
      cursor: null,
    });
  });

  it('skips locations that resolve to null (deleted/inaccessible)', async () => {
    const { request, client } = fakeClient();
    request
      .mockResolvedValueOnce(
        locationsPage(
          [{ id: 'gid://shopify/Location/9', name: 'Stale' }],
          { hasNextPage: false, endCursor: null },
        ),
      )
      .mockResolvedValueOnce({ location: null });

    const collected = [];
    for await (const level of fetchInventoryLevels(client)) collected.push(level);
    expect(collected).toEqual([]);
  });

  it('rejects malformed inventory data via Zod', async () => {
    const { request, client } = fakeClient();
    request
      .mockResolvedValueOnce(
        locationsPage(
          [{ id: 'gid://shopify/Location/1', name: 'Main Warehouse' }],
          { hasNextPage: false, endCursor: null },
        ),
      )
      .mockResolvedValueOnce(
        levelsPage(
          [makeLevelNode({ quantities: [{ name: 'available', quantity: 1.5 }] })],
          { hasNextPage: false, endCursor: null },
        ),
      );

    await expect(async () => {
      for await (const _ of fetchInventoryLevels(client)) {
        void _;
      }
    }).rejects.toThrow();
  });
});

describe('fetchInventoryLevels location coverage', () => {
  async function locationVariables(options?: { allLocations?: boolean }): Promise<unknown> {
    const { request, client } = fakeClient();
    request.mockResolvedValueOnce(locationsPage([], { hasNextPage: false, endCursor: null }));
    for await (const _ of fetchInventoryLevels(client, options)) {
      // drain
    }
    const [document, variables] = request.mock.calls[0] as [string, Record<string, unknown>];
    expect(document).toContain('includeInactive: $all');
    expect(document).toContain('includeLegacy: $all');
    return variables;
  }

  it('asks for deactivated and legacy locations when allLocations is set', async () => {
    expect(await locationVariables({ allLocations: true })).toMatchObject({ all: true });
  });

  it('keeps to active locations by default, matching snapshots from 1.0.1 and earlier', async () => {
    expect(await locationVariables()).toMatchObject({ all: false });
  });
});
