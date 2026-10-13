import {
  ProductSchema,
  ProductVariantSchema,
  type Product,
  type ProductVariant,
} from '../../schemas';
import { type Requester } from '../client';
import { paginate, type PageInfo } from '../pagination';
import { parseWithContext } from '../validate';

const PRODUCTS_PAGE_SIZE = 50;
const VARIANTS_PAGE_SIZE = 100;

const VARIANT_FRAGMENT = `
  fragment FallbackVariantFields on ProductVariant {
    id
    title
    sku
    barcode
    price
    compareAtPrice
    position
    inventoryPolicy
    inventoryQuantity
    taxable
    taxCode
    createdAt
    updatedAt
    product { id }
    selectedOptions { name value }
    inventoryItem {
      id
      tracked
      requiresShipping
      measurement {
        weight { value unit }
      }
    }
  }
`;

const PRODUCTS_QUERY = `
  ${VARIANT_FRAGMENT}
  query FallbackProductsPage($cursor: String) {
    shop { currencyCode }
    products(first: ${PRODUCTS_PAGE_SIZE}, after: $cursor) {
      edges {
        node {
          id
          handle
          title
          descriptionHtml
          productType
          vendor
          tags
          status
          templateSuffix
          createdAt
          updatedAt
          publishedAt
          seo { title description }
          options { id name position values }
          variants(first: ${VARIANTS_PAGE_SIZE}) {
            edges { node { ...FallbackVariantFields } }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const VARIANTS_CONTINUATION_QUERY = `
  ${VARIANT_FRAGMENT}
  query FallbackProductVariantsContinuation($productId: ID!, $cursor: String) {
    product(id: $productId) {
      variants(first: ${VARIANTS_PAGE_SIZE}, after: $cursor) {
        edges { node { ...FallbackVariantFields } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

interface RawVariantNode {
  id: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  price: string;
  compareAtPrice: string | null;
  position: number;
  inventoryPolicy: string;
  inventoryQuantity: number | null;
  taxable: boolean;
  taxCode: string | null;
  createdAt: string;
  updatedAt: string;
  product: { id: string };
  selectedOptions: Array<{ name: string; value: string }>;
  inventoryItem: {
    id: string;
    tracked: boolean;
    requiresShipping: boolean;
    measurement: { weight: { value: number; unit: string } | null };
  };
}

interface RawVariantConnection {
  edges: Array<{ node: RawVariantNode }>;
  pageInfo: PageInfo;
}

interface RawProductNode {
  id: string;
  handle: string;
  title: string;
  descriptionHtml: string;
  productType: string;
  vendor: string;
  tags: string[];
  status: string;
  templateSuffix: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  seo: { title: string | null; description: string | null };
  options: Array<{ id: string; name: string; position: number; values: string[] }>;
  variants: RawVariantConnection;
}

interface ProductsResponse {
  shop: { currencyCode: string };
  products: {
    edges: Array<{ node: RawProductNode }>;
    pageInfo: PageInfo;
  };
}

interface VariantsContinuationResponse {
  product: { variants: RawVariantConnection } | null;
}

export interface ProductWithVariants {
  product: Product;
  variants: ProductVariant[];
}

export async function* fetchProducts(client: Requester): AsyncIterable<ProductWithVariants> {
  const rawProducts = paginate<{ node: RawProductNode; currencyCode: string }>(async (cursor) => {
    const response = await client.request<ProductsResponse>(PRODUCTS_QUERY, { cursor });
    const currencyCode = response.shop.currencyCode;
    return {
      nodes: response.products.edges.map((edge) => ({ node: edge.node, currencyCode })),
      pageInfo: response.products.pageInfo,
    };
  });

  let productIndex = 0;
  for await (const { node, currencyCode } of rawProducts) {
    yield await buildProductWithVariants(client, node, currencyCode, productIndex);
    productIndex++;
  }
}

async function buildProductWithVariants(
  client: Requester,
  node: RawProductNode,
  currencyCode: string,
  productIndex: number,
): Promise<ProductWithVariants> {
  const productInput = {
    id: node.id,
    handle: node.handle,
    title: node.title,
    descriptionHtml: node.descriptionHtml,
    productType: node.productType,
    vendor: node.vendor,
    tags: node.tags,
    status: node.status,
    templateSuffix: node.templateSuffix,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    publishedAt: node.publishedAt,
    seo: node.seo,
    options: node.options,
  };
  const product = parseWithContext(ProductSchema, productInput, {
    fetcher: 'products',
    pathPrefix: ['products', productIndex],
  });

  const variants: ProductVariant[] = [];
  let variantIndex = 0;
  for await (const raw of paginateVariants(client, node.id, node.variants)) {
    variants.push(parseVariant(raw, currencyCode, productIndex, variantIndex));
    variantIndex++;
  }
  return { product, variants };
}

async function* paginateVariants(
  client: Requester,
  productId: string,
  firstPage: RawVariantConnection,
): AsyncIterable<RawVariantNode> {
  for (const edge of firstPage.edges) yield edge.node;
  if (!firstPage.pageInfo.hasNextPage) return;

  let cursor = firstPage.pageInfo.endCursor;
  while (cursor !== null) {
    const response = await client.request<VariantsContinuationResponse>(
      VARIANTS_CONTINUATION_QUERY,
      { productId, cursor },
    );
    if (response.product === null) return;
    const conn = response.product.variants;
    for (const edge of conn.edges) yield edge.node;
    if (!conn.pageInfo.hasNextPage) return;
    cursor = conn.pageInfo.endCursor;
  }
}

function parseVariant(
  node: RawVariantNode,
  currencyCode: string,
  productIndex: number,
  variantIndex: number,
): ProductVariant {
  const input = {
    id: node.id,
    product: node.product,
    title: node.title,
    sku: node.sku,
    barcode: node.barcode,
    // Primary-market pricing only. Per-market resolution via PriceList queries lands in v0.2.
    price: { amount: node.price, currencyCode },
    compareAtPrice: node.compareAtPrice
      ? { amount: node.compareAtPrice, currencyCode }
      : null,
    position: node.position,
    inventoryPolicy: node.inventoryPolicy,
    inventoryQuantity: node.inventoryQuantity,
    taxable: node.taxable,
    taxCode: node.taxCode,
    selectedOptions: node.selectedOptions,
    inventoryItem: node.inventoryItem,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
  return parseWithContext(ProductVariantSchema, input, {
    fetcher: 'products',
    pathPrefix: ['products', productIndex, 'variants', variantIndex],
  });
}
