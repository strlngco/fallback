import { z } from 'zod';
import { DateTimeSchema, GidSchema } from './common';

export const MetafieldOwnerTypeSchema = z.string().min(1);

export const MetafieldSchema = z.object({
  id: GidSchema,
  ownerId: GidSchema,
  ownerType: MetafieldOwnerTypeSchema,
  namespace: z.string().min(1),
  key: z.string().min(1),
  type: z.string().min(1),
  value: z.string(),
  description: z.string().nullable(),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
});

export type MetafieldOwnerType = z.infer<typeof MetafieldOwnerTypeSchema>;
export type Metafield = z.infer<typeof MetafieldSchema>;
