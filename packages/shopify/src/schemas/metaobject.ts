import { z } from 'zod';
import { DateTimeSchema, GidSchema } from './common';

export const MetaobjectFieldSchema = z.object({
  key: z.string().min(1),
  type: z.string().min(1),
  value: z.string().nullable(),
});

export type MetaobjectField = z.infer<typeof MetaobjectFieldSchema>;

export const MetaobjectSchema = z.object({
  id: GidSchema,
  type: z.string().min(1),
  handle: z.string().min(1),
  displayName: z.string(),
  updatedAt: DateTimeSchema,
  fields: z.array(MetaobjectFieldSchema),
});

export type Metaobject = z.infer<typeof MetaobjectSchema>;
