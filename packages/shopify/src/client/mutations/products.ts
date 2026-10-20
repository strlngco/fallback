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

// A product restore is one productUpdate plus one productVariantsBulkUpdate per
// 100 variants, and each call commits on its own. When a later call fails, the
// earlier writes stand, so the error says what was already written.
export class PartialProductRestoreError extends Error {
  override readonly name = 'PartialProductRestoreError';
  readonly written: readonly string[];
  constructor(cause: unknown, written: readonly string[]) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.written = written;
  }
}

export async function restoreProduct(client: Requester, op: RestoreOperation): Promise<void> {
  const inputs = buildProductMutationInputs(op);
  const written: string[] = [];
  let variantsWritten = 0;

  try {
    if (inputs.product !== null) {
      await runProductUpdate(client, inputs.product);
      written.push('product fields');
    }
    for (const batch of chunk(inputs.variants, VARIANTS_PER_CALL)) {
      await runVariantsBulkUpdate(client, inputs.productId, batch);
      variantsWritten += batch.length;
    }
  } catch (err) {
    if (variantsWritten > 0) {
      written.push(`${variantsWritten} of ${inputs.variants.length} variants`);
    }
    if (written.length === 0) throw err;
    throw new PartialProductRestoreError(err, written);
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
