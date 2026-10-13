import { z } from 'zod';
import { GidSchema } from './common';

export const MetafieldDefinitionValidationSchema = z.object({
  name: z.string(),
  type: z.string(),
  value: z.string().nullable(),
});

export type MetafieldDefinitionValidation = z.infer<typeof MetafieldDefinitionValidationSchema>;

export const MetafieldDefinitionSchema = z.object({
  id: GidSchema,
  ownerType: z.string().min(1),
  namespace: z.string().min(1),
  key: z.string().min(1),
  name: z.string(),
  description: z.string().nullable(),
  type: z.string().min(1),
  validations: z.array(MetafieldDefinitionValidationSchema),
});

export type MetafieldDefinition = z.infer<typeof MetafieldDefinitionSchema>;
