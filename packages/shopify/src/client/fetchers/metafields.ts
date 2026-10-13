import { MetafieldSchema, type Metafield } from '../../schemas';
import { type Requester } from '../client';
import { paginate, type PageInfo } from '../pagination';
import { parseWithContext } from '../validate';

const METAFIELDS_PAGE_SIZE = 100;

const METAFIELD_SELECTION = `
          node {
            id
            namespace
            key
            type
            value
            description
            ownerType
            createdAt
            updatedAt
          }
`;

type OwnerQueryField = 'product' | 'productVariant' | 'collection';

function ownerMetafieldsQuery(ownerField: OwnerQueryField): string {
  const opName = ownerField.charAt(0).toUpperCase() + ownerField.slice(1);
  return `
  query Fallback${opName}MetafieldsPage($ownerId: ID!, $cursor: String) {
    ${ownerField}(id: $ownerId) {
      metafields(first: ${METAFIELDS_PAGE_SIZE}, after: $cursor) {
        edges {
${METAFIELD_SELECTION}
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;
}

const SHOP_METAFIELDS_QUERY = `
  query FallbackShopMetafieldsPage($cursor: String) {
    shop {
      id
      metafields(first: ${METAFIELDS_PAGE_SIZE}, after: $cursor) {
        edges {
${METAFIELD_SELECTION}
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

interface RawMetafieldNode {
  id: string;
  namespace: string;
  key: string;
  type: string;
  value: string;
  description: string | null;
  ownerType: string;
  createdAt: string;
  updatedAt: string;
}

interface MetafieldsPage {
  metafields: {
    edges: Array<{ node: RawMetafieldNode }>;
    pageInfo: PageInfo;
  };
}

function parseNodes(
  edges: Array<{ node: RawMetafieldNode }>,
  ownerId: string,
  state: { index: number },
): Metafield[] {
  return edges.map((edge) => {
    const input = {
      id: edge.node.id,
      ownerId,
      ownerType: edge.node.ownerType,
      namespace: edge.node.namespace,
      key: edge.node.key,
      type: edge.node.type,
      value: edge.node.value,
      description: edge.node.description,
      createdAt: edge.node.createdAt,
      updatedAt: edge.node.updatedAt,
    };
    const parsed = parseWithContext(MetafieldSchema, input, {
      fetcher: 'metafields',
      pathPrefix: ['metafields', state.index],
    });
    state.index++;
    return parsed;
  });
}

async function* fetchOwnerMetafields(
  client: Requester,
  ownerField: OwnerQueryField,
  ownerIds: Iterable<string> | AsyncIterable<string>,
): AsyncIterable<Metafield> {
  // One paginated query per owner ID (N+1). Batching via GraphQL aliases or bulk operations
  // remains a deferred optimization.
  const query = ownerMetafieldsQuery(ownerField);
  const state = { index: 0 };
  for await (const ownerId of ownerIds) {
    yield* paginate<Metafield>(async (cursor) => {
      const response = await client.request<Record<string, MetafieldsPage | null>>(query, {
        ownerId,
        cursor,
      });
      const owner = response[ownerField];
      if (owner === null || owner === undefined) {
        return { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
      }
      return {
        nodes: parseNodes(owner.metafields.edges, ownerId, state),
        pageInfo: owner.metafields.pageInfo,
      };
    });
  }
}

export function fetchProductMetafields(
  client: Requester,
  ownerIds: Iterable<string> | AsyncIterable<string>,
): AsyncIterable<Metafield> {
  return fetchOwnerMetafields(client, 'product', ownerIds);
}

export function fetchVariantMetafields(
  client: Requester,
  ownerIds: Iterable<string> | AsyncIterable<string>,
): AsyncIterable<Metafield> {
  return fetchOwnerMetafields(client, 'productVariant', ownerIds);
}

export function fetchCollectionMetafields(
  client: Requester,
  ownerIds: Iterable<string> | AsyncIterable<string>,
): AsyncIterable<Metafield> {
  return fetchOwnerMetafields(client, 'collection', ownerIds);
}

export async function* fetchShopMetafields(client: Requester): AsyncIterable<Metafield> {
  const state = { index: 0 };
  yield* paginate<Metafield>(async (cursor) => {
    const response = await client.request<{ shop: ({ id: string } & MetafieldsPage) | null }>(
      SHOP_METAFIELDS_QUERY,
      { cursor },
    );
    if (response.shop === null) {
      return { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
    }
    return {
      nodes: parseNodes(response.shop.metafields.edges, response.shop.id, state),
      pageInfo: response.shop.metafields.pageInfo,
    };
  });
}
