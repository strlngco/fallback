export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface PageResult<TNode> {
  nodes: TNode[];
  pageInfo: PageInfo;
}

export type FetchPage<TNode> = (cursor: string | null) => Promise<PageResult<TNode>>;

export async function* paginate<TNode>(fetchPage: FetchPage<TNode>): AsyncIterable<TNode> {
  let cursor: string | null = null;
  while (true) {
    const page = await fetchPage(cursor);
    for (const node of page.nodes) yield node;
    if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) return;
    cursor = page.pageInfo.endCursor;
  }
}
