import { z } from 'zod';
import { DateTimeSchema, GidSchema, ImageSchema, SeoSchema } from './common';

export const CollectionSortOrderSchema = z.enum([
  'MANUAL',
  'BEST_SELLING',
  'ALPHA_ASC',
  'ALPHA_DESC',
  'PRICE_ASC',
  'PRICE_DESC',
  'CREATED',
  'CREATED_DESC',
]);

export const CollectionRuleSchema = z.object({
  column: z.string(),
  relation: z.string(),
  condition: z.string(),
});

export const CollectionRuleSetSchema = z.object({
  appliedDisjunctively: z.boolean(),
  rules: z.array(CollectionRuleSchema),
});

export const CollectionMemberSchema = z.object({
  id: GidSchema,
  handle: z.string().min(1),
});

export const CollectionSchema = z.object({
  id: GidSchema,
  handle: z.string().min(1),
  title: z.string(),
  descriptionHtml: z.string(),
  templateSuffix: z.string().nullable(),
  sortOrder: CollectionSortOrderSchema,
  image: ImageSchema.nullable(),
  seo: SeoSchema,
  ruleSet: CollectionRuleSetSchema.nullable(),
  products: z.array(CollectionMemberSchema),
  updatedAt: DateTimeSchema,
});

export type CollectionSortOrder = z.infer<typeof CollectionSortOrderSchema>;
export type CollectionRule = z.infer<typeof CollectionRuleSchema>;
export type CollectionRuleSet = z.infer<typeof CollectionRuleSetSchema>;
export type CollectionMember = z.infer<typeof CollectionMemberSchema>;
export type Collection = z.infer<typeof CollectionSchema>;
