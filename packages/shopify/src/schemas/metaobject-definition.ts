import { z } from 'zod';
import { GidSchema } from './common';
import { MetafieldDefinitionValidationSchema } from './metafield-definition';

export const MetaobjectFieldDefinitionSchema = z.object({
  key: z.string().min(1),
  name: z.string(),
  description: z.string().nullable(),
  required: z.boolean(),
  type: z.string().min(1),
  validations: z.array(MetafieldDefinitionValidationSchema),
});

export type MetaobjectFieldDefinition = z.infer<typeof MetaobjectFieldDefinitionSchema>;

export const MetaobjectDefinitionSchema = z.object({
  id: GidSchema,
  type: z.string().min(1),
  name: z.string(),
  description: z.string().nullable(),
  displayNameKey: z.string().nullable(),
  fieldDefinitions: z.array(MetaobjectFieldDefinitionSchema),
});

export type MetaobjectDefinition = z.infer<typeof MetaobjectDefinitionSchema>;
