import type { RestoreOperation } from '@strlngco/fallback-core';
import { ShopifyUserError, type Requester, type ShopifyUserErrorEntry } from '../client';
import { MetafieldSchema } from '../../schemas';

export const METAFIELD_SUPPORTED_PATHS = ['value', 'type'];

const METAFIELDS_SET_MUTATION = `
  mutation FallbackRestoreMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message }
    }
  }
`;

interface MetafieldsSetInput {
  ownerId: string;
  namespace: string;
  key: string;
  type: string;
  value: string;
}

export async function restoreMetafields(client: Requester, ops: RestoreOperation[]): Promise<void> {
  if (ops.length === 0) return;
  const metafields: MetafieldsSetInput[] = ops.map((op) => {
    const record = MetafieldSchema.parse(op.targetRecord);
    return {
      ownerId: record.ownerId,
      namespace: record.namespace,
      key: record.key,
      type: record.type,
      value: record.value,
    };
  });
  const res = await client.request<{ metafieldsSet: { userErrors: ShopifyUserErrorEntry[] } }>(
    METAFIELDS_SET_MUTATION,
    { metafields },
  );
  if (res.metafieldsSet.userErrors.length > 0) {
    throw new ShopifyUserError('metafieldsSet', res.metafieldsSet.userErrors);
  }
}
