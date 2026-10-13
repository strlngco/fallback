import { z } from 'zod';
import type { RestoreOperation } from '@strlngco/fallback-core';
import { ProductSchema, ProductVariantSchema } from '../../schemas';

export const PRODUCT_SUPPORTED_PATHS = [
  'title',
  'descriptionHtml',
  'productType',
  'vendor',
  'tags',
  'status',
  'templateSuffix',
  'handle',
  'seo',
];

export const VARIANT_SUPPORTED_PATHS = [
  'variants[*].price',
  'variants[*].compareAtPrice',
  'variants[*].barcode',
  'variants[*].taxable',
  'variants[*].taxCode',
  'variants[*].inventoryPolicy',
  'variants[*].sku',
  'variants[*].inventoryItem.measurement.weight',
];

export interface SeoInput {
  title: string | null;
  description: string | null;
}

export interface ProductUpdateInput {
  id: string;
  title?: string;
  descriptionHtml?: string;
  productType?: string;
  vendor?: string;
  tags?: string[];
  status?: string;
  templateSuffix?: string | null;
  handle?: string;
  seo?: SeoInput;
}

export interface WeightInput {
  value: number;
  unit: string;
}

export interface InventoryItemInput {
  sku?: string | null;
  measurement?: { weight: WeightInput | null };
}

export interface ProductVariantsBulkInput {
  id: string;
  price?: string;
  compareAtPrice?: string | null;
  barcode?: string | null;
  taxable?: boolean;
  taxCode?: string | null;
  inventoryPolicy?: string;
  inventoryItem?: InventoryItemInput;
}

const FlatProductSchema = ProductSchema.extend({
  variants: z.array(ProductVariantSchema),
});

type FlatProduct = z.infer<typeof FlatProductSchema>;

const VARIANT_PATH = /^variants\[(.+?)\]\.(.+)$/;

export function buildProductMutationInputs(op: RestoreOperation): {
  productId: string;
  product: ProductUpdateInput | null;
  variants: ProductVariantsBulkInput[];
} {
  const snapshot = FlatProductSchema.parse(op.targetRecord);

  const product: ProductUpdateInput = { id: snapshot.id };
  let productTouched = false;
  const variantInputs = new Map<string, ProductVariantsBulkInput>();

  for (const change of op.changes) {
    const variantMatch = VARIANT_PATH.exec(change.path);
    if (variantMatch) {
      const variantId = variantMatch[1] as string;
      const field = variantMatch[2] as string;
      applyVariantField(snapshot, variantId, field, variantInputs);
    } else {
      productTouched = applyProductField(snapshot, change.path, product) || productTouched;
    }
  }

  return {
    productId: snapshot.id,
    product: productTouched ? product : null,
    variants: [...variantInputs.values()],
  };
}

function applyProductField(snapshot: FlatProduct, path: string, out: ProductUpdateInput): boolean {
  if (path === 'title') return set(out, 'title', snapshot.title);
  if (path === 'descriptionHtml') return set(out, 'descriptionHtml', snapshot.descriptionHtml);
  if (path === 'productType') return set(out, 'productType', snapshot.productType);
  if (path === 'vendor') return set(out, 'vendor', snapshot.vendor);
  if (path === 'tags') return set(out, 'tags', snapshot.tags);
  if (path === 'status') return set(out, 'status', snapshot.status);
  if (path === 'templateSuffix') return set(out, 'templateSuffix', snapshot.templateSuffix);
  if (path === 'handle') return set(out, 'handle', snapshot.handle);
  if (path === 'seo' || path.startsWith('seo.')) {
    out.seo = { title: snapshot.seo.title, description: snapshot.seo.description };
    return true;
  }
  return false;
}

function applyVariantField(
  snapshot: FlatProduct,
  variantId: string,
  field: string,
  out: Map<string, ProductVariantsBulkInput>,
): void {
  const variant = snapshot.variants.find((v) => v.id === variantId);
  if (variant === undefined) return;
  const input = out.get(variantId) ?? { id: variantId };

  let matched = false;
  if (field === 'price' || field.startsWith('price.')) { input.price = variant.price.amount; matched = true; }
  else if (field === 'compareAtPrice' || field.startsWith('compareAtPrice.')) { input.compareAtPrice = variant.compareAtPrice?.amount ?? null; matched = true; }
  else if (field === 'barcode') { input.barcode = variant.barcode; matched = true; }
  else if (field === 'taxable') { input.taxable = variant.taxable; matched = true; }
  else if (field === 'taxCode') { input.taxCode = variant.taxCode; matched = true; }
  else if (field === 'inventoryPolicy') { input.inventoryPolicy = variant.inventoryPolicy; matched = true; }
  else if (field === 'sku') {
    input.inventoryItem = { ...input.inventoryItem, sku: variant.sku };
    matched = true;
  } else if (field.startsWith('inventoryItem.measurement.weight')) {
    const weight = variant.inventoryItem.measurement.weight;
    input.inventoryItem = {
      ...input.inventoryItem,
      measurement: { weight: weight ? { value: weight.value, unit: weight.unit } : null },
    };
    matched = true;
  }

  if (matched) out.set(variantId, input);
}

function set<K extends keyof ProductUpdateInput>(
  out: ProductUpdateInput,
  key: K,
  value: ProductUpdateInput[K],
): boolean {
  out[key] = value;
  return true;
}
