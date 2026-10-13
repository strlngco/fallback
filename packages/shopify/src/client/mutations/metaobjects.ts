import type { RestoreOperation } from '@strlngco/fallback-core';
import { ShopifyUserError, type Requester, type ShopifyUserErrorEntry } from '../client';
import { MetaobjectSchema } from '../../schemas';

export const METAOBJECT_SUPPORTED_PATHS = ['fields[*].value'];

// metaobjectUpdate, deliberately not metaobjectUpsert: upsert creates on a missing
// handle, which would breach restore's never-create boundary.
const METAOBJECT_UPDATE_MUTATION = `
  mutation FallbackRestoreMetaobject($id: ID!, $fields: [MetaobjectFieldInput!]) {
    metaobjectUpdate(id: $id, metaobject: { fields: $fields }) {
      metaobject { id }
      userErrors { field message }
    }
  }
`;

const FIELD_PATH = /^fields\[(.+?)\]\.value$/;

export async function restoreMetaobject(client: Requester, op: RestoreOperation): Promise<void> {
  const snapshot = MetaobjectSchema.parse(op.targetRecord);

  const fields: Array<{ key: string; value: string }> = [];
  for (const change of op.changes) {
    const match = FIELD_PATH.exec(change.path);
    if (match === null) continue;
    const key = match[1] as string;
    const field = snapshot.fields.find((f) => f.key === key);
    if (field === undefined) continue;
    // MetaobjectFieldInput.value is String! — an empty string is the write-side
    // representation of a cleared (null-on-read) field value.
    fields.push({ key, value: field.value ?? '' });
  }
  // Unreachable via the current plan builder: it only emits a metaobjects op when at
  // least one change matches fields[*].value and that key exists in the snapshot
  // record, so `fields` is always non-empty here. If it ever arrives empty, that's a
  // plan-builder bug — but failing the whole restore over a single no-op operation
  // would cost more than silently skipping the mutation, so we return rather than throw.
  if (fields.length === 0) return;

  const res = await client.request<{
    metaobjectUpdate: { userErrors: ShopifyUserErrorEntry[] };
  }>(METAOBJECT_UPDATE_MUTATION, { id: snapshot.id, fields });
  if (res.metaobjectUpdate.userErrors.length > 0) {
    throw new ShopifyUserError('metaobjectUpdate', res.metaobjectUpdate.userErrors);
  }
}
