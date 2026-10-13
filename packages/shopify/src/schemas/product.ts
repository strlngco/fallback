import { z } from 'zod';
import { DateTimeSchema, GidSchema, SeoSchema } from './common';

// Was z.enum(['ACTIVE','ARCHIVED','DRAFT']) — Shopify added UNLISTED (2025-10)
// and a live store hit it (2026-07-08). Once Shopify extends an enum it is an
// extensible value per the charter's schema discipline, so it parses as a string.
export const ProductStatusSchema = z.string().min(1);

export const ProductOptionSchema = z.object({
  id: GidSchema,
  name: z.string(),
  position: z.number().int().positive(),
  values: z.array(z.string()),
});

export const ProductSchema = z.object({
  id: GidSchema,
  handle: z.string().min(1),
  title: z.string(),
  descriptionHtml: z.string(),
  productType: z.string(),
  vendor: z.string(),
  tags: z.array(z.string()),
  status: ProductStatusSchema,
  templateSuffix: z.string().nullable(),
  options: z.array(ProductOptionSchema),
  seo: SeoSchema,
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
  publishedAt: DateTimeSchema.nullable(),
});

export type ProductStatus = z.infer<typeof ProductStatusSchema>;
export type ProductOption = z.infer<typeof ProductOptionSchema>;
export type Product = z.infer<typeof ProductSchema>;
