import { z } from 'zod';
import { DateTimeSchema, GidSchema } from './common';

// InventoryLevel GIDs ship with a query-string suffix carrying the parent
// inventory_item_id, e.g. gid://shopify/InventoryLevel/123?inventory_item_id=456.
// This shape is specific to InventoryLevel.id; other GIDs remain bare via GidSchema.
const InventoryLevelGidSchema = z
  .string()
  .regex(
    /^gid:\/\/shopify\/InventoryLevel\/[0-9]+(?:\?\S+)?$/,
    'Expected an InventoryLevel global ID (e.g. gid://shopify/InventoryLevel/123 or gid://shopify/InventoryLevel/123?inventory_item_id=456)',
  );

export const InventoryQuantitySchema = z.object({
  name: z.string(),
  quantity: z.number().int(),
});

export const InventoryLevelSchema = z.object({
  id: InventoryLevelGidSchema,
  item: z.object({ id: GidSchema }),
  location: z.object({
    id: GidSchema,
    name: z.string(),
  }),
  quantities: z.array(InventoryQuantitySchema),
  updatedAt: DateTimeSchema,
});

export type InventoryQuantity = z.infer<typeof InventoryQuantitySchema>;
export type InventoryLevel = z.infer<typeof InventoryLevelSchema>;
