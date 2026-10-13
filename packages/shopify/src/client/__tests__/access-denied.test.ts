import { describe, expect, it } from 'vitest';
import { ClientError } from 'graphql-request';
import { ShopifyAccessDeniedError, mapError } from '../client';

function clientError(code: string, message: string): ClientError {
  return new ClientError(
    { errors: [{ message, extensions: { code } }], status: 200 } as never,
    { query: 'query { x }' } as never,
  );
}

describe('mapError access denied', () => {
  it('maps ACCESS_DENIED to ShopifyAccessDeniedError carrying the API message', () => {
    const err = mapError(
      clientError(
        'ACCESS_DENIED',
        'Access denied for metaobjectDefinitions field. Required access: `read_metaobject_definitions` access scope.',
      ),
    );
    expect(err).toBeInstanceOf(ShopifyAccessDeniedError);
    expect(err.message).toContain('read_metaobject_definitions');
  });

  it('keeps other codes on ShopifyGraphQLError', () => {
    const err = mapError(clientError('INTERNAL_SERVER_ERROR', 'boom'));
    expect(err).not.toBeInstanceOf(ShopifyAccessDeniedError);
  });
});
