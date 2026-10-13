import {
  MetaobjectDefinitionSchema,
  MetaobjectSchema,
  type Metaobject,
  type MetaobjectDefinition,
} from '../../schemas';
import { type Requester } from '../client';
import { paginate, type PageInfo } from '../pagination';
import { parseWithContext } from '../validate';

const DEFINITIONS_PAGE_SIZE = 50;
const ENTRIES_PAGE_SIZE = 100;

// Shopify returns these as empty connections rather than an ACCESS_DENIED error when the
// app lacks them (see scope-preflight.ts in the cli package for the fail-fast guard this
// backs) — capture order matters for the missing-scope message, not for correctness.
export const METAOBJECT_READ_SCOPES: readonly string[] = [
  'read_metaobjects',
  'read_metaobject_definitions',
];

const METAOBJECT_DEFINITIONS_QUERY = `
  query FallbackMetaobjectDefinitionsPage($cursor: String) {
    metaobjectDefinitions(first: ${DEFINITIONS_PAGE_SIZE}, after: $cursor) {
      edges {
        node {
          id
          type
          name
          description
          displayNameKey
          fieldDefinitions {
            key
            name
            description
            required
            type { name }
            validations { name type value }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const METAOBJECTS_QUERY = `
  query FallbackMetaobjectsPage($type: String!, $cursor: String) {
    metaobjects(type: $type, first: ${ENTRIES_PAGE_SIZE}, after: $cursor) {
      edges {
        node {
          id
          type
          handle
          displayName
          updatedAt
          fields { key type value }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

interface RawFieldDefinition {
  key: string;
  name: string;
  description: string | null;
  required: boolean;
  type: { name: string };
  validations: Array<{ name: string; type: string; value: string | null }>;
}

interface RawDefinitionNode {
  id: string;
  type: string;
  name: string;
  description: string | null;
  displayNameKey: string | null;
  fieldDefinitions: RawFieldDefinition[];
}

interface DefinitionsResponse {
  metaobjectDefinitions: {
    edges: Array<{ node: RawDefinitionNode }>;
    pageInfo: PageInfo;
  };
}

interface EntriesResponse {
  metaobjects: {
    edges: Array<{ node: unknown }>;
    pageInfo: PageInfo;
  };
}

export async function* fetchMetaobjectDefinitions(
  client: Requester,
): AsyncIterable<MetaobjectDefinition> {
  let index = 0;
  yield* paginate<MetaobjectDefinition>(async (cursor) => {
    const response = await client.request<DefinitionsResponse>(METAOBJECT_DEFINITIONS_QUERY, {
      cursor,
    });
    return {
      nodes: response.metaobjectDefinitions.edges.map((edge) => {
        const input = {
          ...edge.node,
          fieldDefinitions: edge.node.fieldDefinitions.map((fd) => ({
            ...fd,
            type: fd.type.name,
          })),
        };
        const parsed = parseWithContext(MetaobjectDefinitionSchema, input, {
          fetcher: 'metaobjects',
          pathPrefix: ['metaobjectDefinitions', index],
        });
        index++;
        return parsed;
      }),
      pageInfo: response.metaobjectDefinitions.pageInfo,
    };
  });
}

export async function* fetchMetaobjects(
  client: Requester,
  types: Iterable<string> | AsyncIterable<string>,
): AsyncIterable<Metaobject> {
  let index = 0;
  for await (const type of types) {
    yield* paginate<Metaobject>(async (cursor) => {
      const response = await client.request<EntriesResponse>(METAOBJECTS_QUERY, { type, cursor });
      return {
        nodes: response.metaobjects.edges.map((edge) => {
          const parsed = parseWithContext(MetaobjectSchema, edge.node, {
            fetcher: 'metaobjects',
            pathPrefix: ['metaobjects', index],
          });
          index++;
          return parsed;
        }),
        pageInfo: response.metaobjects.pageInfo,
      };
    });
  }
}
