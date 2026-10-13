import { InventoryLevelSchema, type InventoryLevel } from '../../schemas';
import { type Requester } from '../client';
import { paginate, type PageInfo } from '../pagination';
import { parseWithContext } from '../validate';

const LOCATIONS_PAGE_SIZE = 50;
const INVENTORY_LEVELS_PAGE_SIZE = 100;

const QUANTITY_NAMES = [
  'available',
  'incoming',
  'committed',
  'reserved',
  'damaged',
  'safety_stock',
  'quality_control',
  'on_hand',
] as const;

const LOCATIONS_QUERY = `
  query FallbackLocationsPage($cursor: String) {
    locations(first: ${LOCATIONS_PAGE_SIZE}, after: $cursor) {
      edges { node { id name } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const INVENTORY_LEVELS_QUERY = `
  query FallbackInventoryLevelsPage($locationId: ID!, $cursor: String) {
    location(id: $locationId) {
      inventoryLevels(first: ${INVENTORY_LEVELS_PAGE_SIZE}, after: $cursor) {
        edges {
          node {
            id
            updatedAt
            item { id }
            quantities(names: ${JSON.stringify(QUANTITY_NAMES)}) {
              name
              quantity
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

interface RawLocationNode {
  id: string;
  name: string;
}

interface LocationsResponse {
  locations: {
    edges: Array<{ node: RawLocationNode }>;
    pageInfo: PageInfo;
  };
}

interface RawInventoryLevelNode {
  id: string;
  updatedAt: string;
  item: { id: string };
  quantities: Array<{ name: string; quantity: number }>;
}

interface InventoryLevelsResponse {
  location: {
    inventoryLevels: {
      edges: Array<{ node: RawInventoryLevelNode }>;
      pageInfo: PageInfo;
    };
  } | null;
}

export async function* fetchInventoryLevels(client: Requester): AsyncIterable<InventoryLevel> {
  let levelIndex = 0;
  for await (const location of fetchLocations(client)) {
    yield* paginate<InventoryLevel>(async (cursor) => {
      const response = await client.request<InventoryLevelsResponse>(INVENTORY_LEVELS_QUERY, {
        locationId: location.id,
        cursor,
      });
      if (response.location === null) {
        return { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
      }
      return {
        nodes: response.location.inventoryLevels.edges.map((edge) => {
          const input = {
            id: edge.node.id,
            item: edge.node.item,
            location: { id: location.id, name: location.name },
            quantities: edge.node.quantities,
            updatedAt: edge.node.updatedAt,
          };
          const parsed = parseWithContext(InventoryLevelSchema, input, {
            fetcher: 'inventory-levels',
            pathPrefix: ['inventoryLevels', levelIndex],
          });
          levelIndex++;
          return parsed;
        }),
        pageInfo: response.location.inventoryLevels.pageInfo,
      };
    });
  }
}

async function* fetchLocations(client: Requester): AsyncIterable<RawLocationNode> {
  yield* paginate<RawLocationNode>(async (cursor) => {
    const response = await client.request<LocationsResponse>(LOCATIONS_QUERY, { cursor });
    return {
      nodes: response.locations.edges.map((edge) => edge.node),
      pageInfo: response.locations.pageInfo,
    };
  });
}
