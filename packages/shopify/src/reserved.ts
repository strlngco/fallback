// Shopify writes and regenerates values in its own namespaces (taxonomy/standard
// metafields, shopify--* metaobject types), and app--* namespaces belong to other
// apps' automation. Restore must not fight either: writes there are rejected or
// silently overwritten, and one rejected entry fails a whole atomic metafieldsSet
// batch. Verified against Admin API 2026-04: such writes return per-batch userErrors.
export function reservedContentReason(value: string): string | null {
  if (value === 'shopify' || value.startsWith('shopify--')) {
    return 'Shopify-managed; not restored';
  }
  if (value.startsWith('app--')) {
    return 'app-owned namespace; not restored';
  }
  return null;
}
