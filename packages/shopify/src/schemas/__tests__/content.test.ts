import { describe, expect, it } from 'vitest';
import { MetafieldDefinitionSchema } from '../metafield-definition';
import { MetaobjectDefinitionSchema } from '../metaobject-definition';
import { MetaobjectSchema } from '../metaobject';

const METAFIELD_DEFINITION = {
  id: 'gid://shopify/MetafieldDefinition/100',
  ownerType: 'PRODUCTVARIANT',
  namespace: 'custom',
  key: 'material',
  name: 'Material',
  description: null,
  type: 'single_line_text_field',
  validations: [{ name: 'max', type: 'integer', value: '80' }],
};

const METAOBJECT_DEFINITION = {
  id: 'gid://shopify/MetaobjectDefinition/200',
  type: 'care_guide',
  name: 'Care guide',
  description: null,
  displayNameKey: 'title',
  fieldDefinitions: [
    {
      key: 'title',
      name: 'Title',
      description: null,
      required: true,
      type: 'single_line_text_field',
      validations: [],
    },
  ],
};

const METAOBJECT = {
  id: 'gid://shopify/Metaobject/300',
  type: 'care_guide',
  handle: 'wool-care',
  displayName: 'Wool care',
  updatedAt: '2026-06-01T00:00:00Z',
  fields: [{ key: 'title', type: 'single_line_text_field', value: 'Wool care' }],
};

describe('content schemas', () => {
  it('accepts a metafield definition and preserves unknown-extensible strings', () => {
    expect(MetafieldDefinitionSchema.parse(METAFIELD_DEFINITION)).toEqual(METAFIELD_DEFINITION);
    const futureType = { ...METAFIELD_DEFINITION, type: 'a_type_shopify_adds_later' };
    expect(MetafieldDefinitionSchema.parse(futureType)).toEqual(futureType);
  });

  it('accepts a metaobject definition with field definitions', () => {
    expect(MetaobjectDefinitionSchema.parse(METAOBJECT_DEFINITION)).toEqual(METAOBJECT_DEFINITION);
  });

  it('accepts a metaobject entry with a null field value', () => {
    const withNull = {
      ...METAOBJECT,
      fields: [{ key: 'title', type: 'single_line_text_field', value: null }],
    };
    expect(MetaobjectSchema.parse(withNull)).toEqual(withNull);
  });

  it('rejects a metaobject without a GID id', () => {
    expect(() => MetaobjectSchema.parse({ ...METAOBJECT, id: 'not-a-gid' })).toThrow();
  });
});
