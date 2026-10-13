import { METAOBJECT_READ_SCOPES, scopeIsGranted, type ScopedRequester } from '@strlngco/fallback-shopify';
import { ScopeError } from './env';

export interface MetaobjectScopeContext {
  verb: string;
  scopeWorkaround: string;
}

// Shopify returns empty results, not an access error, for metaobject queries an app
// lacks scopes for — a snapshot would silently claim coverage while capturing nothing.
// Checking granted scopes up front is the only reliable guard.
export async function assertMetaobjectReadScopes(
  client: ScopedRequester,
  context: MetaobjectScopeContext,
): Promise<void> {
  const granted = await client.getGrantedScopes();
  const missing = METAOBJECT_READ_SCOPES.filter((s) => !scopeIsGranted(granted, s));
  if (missing.length === 0) return;
  throw new ScopeError(
    `${context.verb} metaobjects requires the ${METAOBJECT_READ_SCOPES.join(' and ')} access scopes, ` +
      `but the app was granted: ${granted.length > 0 ? granted.join(', ') : 'none'}. ` +
      `Grant them in the Shopify Dev Dashboard, or exclude metaobjects with ` +
      `--scope ${context.scopeWorkaround}.`,
  );
}
