export class ShopifyConfigError extends Error {
  override readonly name = 'ShopifyConfigError';
}

// The shop domain becomes both the host that receives the client secret and a
// directory name on disk, so anything beyond a bare myshopify.com hostname is
// refused rather than interpreted.
const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

const API_VERSION = /^(\d{4}-\d{2}|unstable)$/;

export function assertShopDomain(domain: string): void {
  if (!SHOP_DOMAIN.test(domain)) {
    throw new ShopifyConfigError(
      `Shop domain must be a myshopify.com domain such as example-store.myshopify.com, ` +
        `with no scheme, path, or port. Got: ${JSON.stringify(domain)}.`,
    );
  }
}

export function assertApiVersion(version: string): void {
  if (!API_VERSION.test(version)) {
    throw new ShopifyConfigError(
      `Shopify API version must look like 2026-04 (or be "unstable"). Got: ${JSON.stringify(version)}.`,
    );
  }
}
