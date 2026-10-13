import type { RestoreOperation } from '@strlngco/fallback-core';
import { ShopifyUserError, type Requester, type ShopifyUserErrorEntry } from '../client';
import {
  buildProductMutationInputs,
  type ProductUpdateInput,
  type ProductVariantsBulkInput,
} from './product-input';

const VARIANTS_PER_CALL = 100;

const PRODUCT_UPDATE_MUTATION = `
  mutation FallbackRestoreProduct($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id }
      userErrors { field message }
    }
  }
`;

const VARIANTS_BULK_UPDATE_MUTATION = `
  mutation FallbackRestoreVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id }
      userErrors { field message }
    }
  }
`;

interface UserErrorPayload {
  userErrors: ShopifyUserErrorEntry[];
}

export async function restoreProduct(client: Requester, op: RestoreOperation): Promise<void> {
  const inputs = buildProductMutationInputs(op);

  if (inputs.product !== null) {
    await runProductUpdate(client, inputs.product);
  }
  for (const batch of chunk(inputs.variants, VARIANTS_PER_CALL)) {
    await runVariantsBulkUpdate(client, inputs.productId, batch);
  }
}

async function runProductUpdate(client: Requester, product: ProductUpdateInput): Promise<void> {
  const res = await client.request<{ productUpdate: UserErrorPayload }>(PRODUCT_UPDATE_MUTATION, {
    product,
  });
  throwOnUserErrors('productUpdate', res.productUpdate.userErrors);
}

async function runVariantsBulkUpdate(
  client: Requester,
  productId: string,
  variants: ProductVariantsBulkInput[],
): Promise<void> {
  const res = await client.request<{ productVariantsBulkUpdate: UserErrorPayload }>(
    VARIANTS_BULK_UPDATE_MUTATION,
    { productId, variants },
  );
  throwOnUserErrors('productVariantsBulkUpdate', res.productVariantsBulkUpdate.userErrors);
}

function throwOnUserErrors(mutation: string, userErrors: ShopifyUserErrorEntry[]): void {
  if (userErrors.length > 0) throw new ShopifyUserError(mutation, userErrors);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
