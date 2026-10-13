import { z } from 'zod';

export const GidSchema = z
  .string()
  .regex(
    /^gid:\/\/shopify\/[A-Za-z]+\/[0-9]+$/,
    'Expected a Shopify global ID (e.g. gid://shopify/Product/123)',
  );

export const MoneyV2Schema = z.object({
  amount: z
    .string()
    .regex(
      /^\d+(\.\d+)?$/,
      'Expected a non-negative decimal amount (e.g. "19.99")',
    ),
  currencyCode: z
    .string()
    .regex(
      /^[A-Z]{3}$/,
      'Expected a three-letter ISO 4217 currency code (e.g. "USD", "CAD")',
    ),
});

export const DateTimeSchema = z.string().datetime({ offset: true });

export const SeoSchema = z.object({
  title: z.string().nullable(),
  description: z.string().nullable(),
});

export const ImageSchema = z.object({
  id: GidSchema,
  url: z.string().url(),
  altText: z.string().nullable(),
});

export type Gid = z.infer<typeof GidSchema>;
export type MoneyV2 = z.infer<typeof MoneyV2Schema>;
export type DateTime = z.infer<typeof DateTimeSchema>;
export type Seo = z.infer<typeof SeoSchema>;
export type Image = z.infer<typeof ImageSchema>;
