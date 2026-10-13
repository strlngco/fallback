import { CollectionSchema, type Collection } from '../../schemas';
import { type Requester } from '../client';
import { paginate, type PageInfo } from '../pagination';
import { parseWithContext } from '../validate';

const COLLECTIONS_PAGE_SIZE = 50;
const MEMBERS_PAGE_SIZE = 250;

const COLLECTIONS_QUERY = `
  query FallbackCollectionsPage($cursor: String) {
    collections(first: ${COLLECTIONS_PAGE_SIZE}, after: $cursor) {
      edges {
        node {
          id
          handle
          title
          descriptionHtml
          templateSuffix
          sortOrder
          updatedAt
          image { id url altText }
          seo { title description }
          ruleSet {
            appliedDisjunctively
            rules { column relation condition }
          }
          products(first: ${MEMBERS_PAGE_SIZE}) {
            edges { node { id handle } }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const MEMBERS_CONTINUATION_QUERY = `
  query FallbackCollectionMembersContinuation($collectionId: ID!, $cursor: String) {
    collection(id: $collectionId) {
      products(first: ${MEMBERS_PAGE_SIZE}, after: $cursor) {
        edges { node { id handle } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

interface RawMember {
  id: string;
  handle: string;
}

interface RawMemberConnection {
  edges: Array<{ node: RawMember }>;
  pageInfo: PageInfo;
}

interface RawCollectionNode {
  id: string;
  handle: string;
  title: string;
  descriptionHtml: string;
  templateSuffix: string | null;
  sortOrder: string;
  updatedAt: string;
  image: { id: string; url: string; altText: string | null } | null;
  seo: { title: string | null; description: string | null };
  ruleSet: {
    appliedDisjunctively: boolean;
    rules: Array<{ column: string; relation: string; condition: string }>;
  } | null;
  products: RawMemberConnection;
}

interface CollectionsResponse {
  collections: {
    edges: Array<{ node: RawCollectionNode }>;
    pageInfo: PageInfo;
  };
}

interface MembersContinuationResponse {
  collection: { products: RawMemberConnection } | null;
}

export async function* fetchCollections(client: Requester): AsyncIterable<Collection> {
  const rawCollections = paginate<RawCollectionNode>(async (cursor) => {
    const response = await client.request<CollectionsResponse>(COLLECTIONS_QUERY, { cursor });
    return {
      nodes: response.collections.edges.map((edge) => edge.node),
      pageInfo: response.collections.pageInfo,
    };
  });

  let collectionIndex = 0;
  for await (const node of rawCollections) {
    yield await buildCollectionWithMembers(client, node, collectionIndex);
    collectionIndex++;
  }
}

async function buildCollectionWithMembers(
  client: Requester,
  node: RawCollectionNode,
  collectionIndex: number,
): Promise<Collection> {
  const products: RawMember[] = [];
  for await (const member of paginateMembers(client, node.id, node.products)) {
    products.push(member);
  }
  const input = {
    id: node.id,
    handle: node.handle,
    title: node.title,
    descriptionHtml: node.descriptionHtml,
    templateSuffix: node.templateSuffix,
    sortOrder: node.sortOrder,
    updatedAt: node.updatedAt,
    image: node.image,
    seo: node.seo,
    ruleSet: node.ruleSet,
    products,
  };
  return parseWithContext(CollectionSchema, input, {
    fetcher: 'collections',
    pathPrefix: ['collections', collectionIndex],
  });
}

async function* paginateMembers(
  client: Requester,
  collectionId: string,
  firstPage: RawMemberConnection,
): AsyncIterable<RawMember> {
  for (const edge of firstPage.edges) yield edge.node;
  if (!firstPage.pageInfo.hasNextPage) return;

  let cursor = firstPage.pageInfo.endCursor;
  while (cursor !== null) {
    const response = await client.request<MembersContinuationResponse>(
      MEMBERS_CONTINUATION_QUERY,
      { collectionId, cursor },
    );
    if (response.collection === null) return;
    const conn = response.collection.products;
    for (const edge of conn.edges) yield edge.node;
    if (!conn.pageInfo.hasNextPage) return;
    cursor = conn.pageInfo.endCursor;
  }
}
