import { MetafieldDefinitionSchema, type MetafieldDefinition } from '../../schemas';
import { type Requester } from '../client';
import { paginate, type PageInfo } from '../pagination';
import { parseWithContext } from '../validate';

const DEFINITIONS_PAGE_SIZE = 100;

// The owner types "content" covers (spec: settled decision 2). Order is capture order
// and the order recorded in the snapshot manifest.
export const CONTENT_METAFIELD_OWNER_TYPES: readonly string[] = [
  'PRODUCT',
  'PRODUCTVARIANT',
  'COLLECTION',
  'SHOP',
];

const METAFIELD_DEFINITIONS_QUERY = `
  query FallbackMetafieldDefinitionsPage($ownerType: MetafieldOwnerType!, $cursor: String) {
    metafieldDefinitions(ownerType: $ownerType, first: ${DEFINITIONS_PAGE_SIZE}, after: $cursor) {
      edges {
        node {
          id
          ownerType
          namespace
          key
          name
          description
          type { name }
          validations { name type value }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

interface RawDefinitionNode {
  id: string;
  ownerType: string;
  namespace: string;
  key: string;
  name: string;
  description: string | null;
  type: { name: string };
  validations: Array<{ name: string; type: string; value: string | null }>;
}

interface DefinitionsResponse {
  metafieldDefinitions: {
    edges: Array<{ node: RawDefinitionNode }>;
    pageInfo: PageInfo;
  };
}

export async function* fetchMetafieldDefinitions(
  client: Requester,
  ownerTypes: readonly string[],
): AsyncIterable<MetafieldDefinition> {
  let index = 0;
  for (const ownerType of ownerTypes) {
    yield* paginate<MetafieldDefinition>(async (cursor) => {
      const response = await client.request<DefinitionsResponse>(METAFIELD_DEFINITIONS_QUERY, {
        ownerType,
        cursor,
      });
      return {
        nodes: response.metafieldDefinitions.edges.map((edge) => {
          const input = {
            id: edge.node.id,
            ownerType: edge.node.ownerType,
            namespace: edge.node.namespace,
            key: edge.node.key,
            name: edge.node.name,
            description: edge.node.description,
            type: edge.node.type.name,
            validations: edge.node.validations,
          };
          const parsed = parseWithContext(MetafieldDefinitionSchema, input, {
            fetcher: 'metafield-definitions',
            pathPrefix: ['metafieldDefinitions', index],
          });
          index++;
          return parsed;
        }),
        pageInfo: response.metafieldDefinitions.pageInfo,
      };
    });
  }
}
