import { z } from 'zod';
import { DateTimeSchema, GidSchema, MoneyV2Schema } from './common';

export const InventoryPolicySchema = z.enum(['DENY', 'CONTINUE']);

export const WeightUnitSchema = z.enum([
  'GRAMS',
  'KILOGRAMS',
  'OUNCES',
  'POUNDS',
]);

export const SelectedOptionSchema = z.object({
  name: z.string(),
  value: z.string(),
});

export const WeightSchema = z.object({
  value: z.number().nonnegative(),
  unit: WeightUnitSchema,
});

export const InventoryItemRefSchema = z.object({
  id: GidSchema,
  tracked: z.boolean(),
  requiresShipping: z.boolean(),
  measurement: z.object({
    weight: WeightSchema.nullable(),
  }),
});

export const ProductVariantSchema = z.object({
  id: GidSchema,
  product: z.object({ id: GidSchema }),
  title: z.string(),
  sku: z.string().nullable(),
  barcode: z.string().nullable(),
  // Primary-market pricing only. Per-market overrides live on PriceList resources, deferred to v0.2.
  price: MoneyV2Schema,
  compareAtPrice: MoneyV2Schema.nullable(),
  position: z.number().int().positive(),
  inventoryPolicy: InventoryPolicySchema,
  inventoryQuantity: z.number().int().nullable(),
  taxable: z.boolean(),
  taxCode: z.string().nullable(),
  selectedOptions: z.array(SelectedOptionSchema),
  inventoryItem: InventoryItemRefSchema,
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
});

export type InventoryPolicy = z.infer<typeof InventoryPolicySchema>;
export type WeightUnit = z.infer<typeof WeightUnitSchema>;
export type SelectedOption = z.infer<typeof SelectedOptionSchema>;
export type Weight = z.infer<typeof WeightSchema>;
export type InventoryItemRef = z.infer<typeof InventoryItemRefSchema>;
export type ProductVariant = z.infer<typeof ProductVariantSchema>;
