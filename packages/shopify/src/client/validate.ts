import type { ZodSchema } from 'zod';
import { ShopifyValidationError } from './client';

export interface ValidationContext {
  fetcher: string;
  pathPrefix: readonly (string | number)[];
}

export function parseWithContext<T>(
  schema: ZodSchema<T>,
  value: unknown,
  context: ValidationContext,
): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new ShopifyValidationError({
    fetcher: context.fetcher,
    pathPrefix: context.pathPrefix,
    issues: result.error.issues,
    rawValue: value,
  });
}
