import { describe, expect, it } from 'vitest';
import { reservedContentReason } from '../reserved';

describe('reservedContentReason', () => {
  it('classifies the shopify namespace and shopify-- prefixed values as Shopify-managed', () => {
    expect(reservedContentReason('shopify')).toBe('Shopify-managed; not restored');
    expect(reservedContentReason('shopify--color-pattern')).toBe('Shopify-managed; not restored');
  });

  it('classifies app-reserved prefixes as app-owned', () => {
    expect(reservedContentReason('app--123456--bakery')).toBe('app-owned namespace; not restored');
  });

  it('passes plain namespaces and types through', () => {
    expect(reservedContentReason('custom')).toBeNull();
    expect(reservedContentReason('my_fields')).toBeNull();
    expect(reservedContentReason('care_guide')).toBeNull();
  });

  it('does not match shopify as a mere prefix of an unreserved name', () => {
    expect(reservedContentReason('shopify_stuff')).toBeNull();
    expect(reservedContentReason('shopifyx')).toBeNull();
  });
});
