import { Command, Option, type BaseContext } from 'clipanion';

import {
  CONTENT_METAFIELD_OWNER_TYPES,
  SHOPIFY_API_VERSION,
  type Collection,
  type InventoryLevel,
  type InventoryLevelsOptions,
  type Metafield,
  type MetafieldDefinition,
  type Metaobject,
  type MetaobjectDefinition,
  type Requester,
  type ScopedRequester,
  type ShopifyClientOptions,
} from '@strlngco/fallback-shopify';

import {
  ScopeError,
  type ResolveAuthOptions,
  type ResolvedAuth,
} from '../env';

import { assertMetaobjectReadScopes } from '../scope-preflight';
import { OutputWriter } from '../output/writer';
import { formatSnapshotSummary } from '../output/format/snapshot';
import { concatIterables, teeKeys } from '../snapshot/iterables';
import {
  type ProductRecord,
  type ScopeFlags,
  type SnapshotResult,
  type SnapshotWriter,
} from '../snapshot/writer';

export interface SnapshotDependencies {
  buildClient: (opts: ShopifyClientOptions) => ScopedRequester;
  buildWriter: (shopDomain: string, baseDir?: string | undefined) => SnapshotWriter;
  fetchers: {
    products: (client: Requester) => AsyncIterable<ProductRecord>;
    collections: (client: Requester) => AsyncIterable<Collection>;
    metafields: (
      client: Requester,
      ownerIds: Iterable<string> | AsyncIterable<string>,
    ) => AsyncIterable<Metafield>;
    variantMetafields: (
      client: Requester,
      ownerIds: Iterable<string> | AsyncIterable<string>,
    ) => AsyncIterable<Metafield>;
    collectionMetafields: (
      client: Requester,
      ownerIds: Iterable<string> | AsyncIterable<string>,
    ) => AsyncIterable<Metafield>;
    shopMetafields: (client: Requester) => AsyncIterable<Metafield>;
    metafieldDefinitions: (
      client: Requester,
      ownerTypes: readonly string[],
    ) => AsyncIterable<MetafieldDefinition>;
    metaobjectDefinitions: (client: Requester) => AsyncIterable<MetaobjectDefinition>;
    metaobjects: (
      client: Requester,
      types: Iterable<string> | AsyncIterable<string>,
    ) => AsyncIterable<Metaobject>;
    inventoryLevels: (client: Requester, options?: InventoryLevelsOptions) => AsyncIterable<InventoryLevel>;
  };
  resolveAuth: (opts: ResolveAuthOptions) => Promise<ResolvedAuth>;
  // Registers a handler for Ctrl-C / SIGTERM and returns a function that
  // unregisters it. Optional so command tests need not supply it.
  onInterrupt?: (handler: () => Promise<void>) => () => void;
  now: () => Date;
  cwd: () => string;
  homeDir: () => string;
  env: () => Record<string, string | undefined>;
}

export interface SnapshotContext extends BaseContext {
  deps: SnapshotDependencies;
}

interface SnapshotSummary extends SnapshotResult {
  shop: string;
  scope: ScopeFlags;
}

export class SnapshotCommand extends Command<SnapshotContext> {
  static override paths = [['snapshot']];

  static override usage = Command.Usage({
    description: 'Capture a snapshot of a Shopify store.',
    details: `
      Reads SHOPIFY_SHOP_DOMAIN, SHOPIFY_CLIENT_ID, and SHOPIFY_CLIENT_SECRET from the
      environment, the project .env, or ~/.fallback/.env, then captures products (with
      variants), collections (custom and smart), metafields (product, variant,
      collection, and shop), metafield definitions, metaobjects, metaobject definitions,
      and inventory levels into a timestamped directory under
      ~/.fallback/snapshots/<shop>/.
    `,
    examples: [
      ['Capture a full snapshot', 'fallback snapshot'],
      ['Override the shop domain', 'fallback snapshot --shop example.myshopify.com'],
      [
        'Capture only products and collections',
        'fallback snapshot --scope products,collections',
      ],
      ['Emit the summary as JSON to stdout', 'fallback snapshot --json'],
    ],
  });

  shop = Option.String('--shop', {
    description: 'Shop domain override (e.g. example.myshopify.com)',
  });
  scope = Option.String('--scope', {
    description:
      'Comma-separated scope: products,collections,metafields,inventory-levels,metaobjects (defaults to all)',
  });
  baseDir = Option.String('--base-dir', {
    description: 'Override the snapshot output base directory (default ~/.fallback/snapshots)',
  });
  json = Option.Boolean('--json', false, {
    description: 'Emit the final summary as JSON to stdout instead of human text to stderr',
  });
  quiet = Option.Boolean('--quiet', false, {
    description: 'Suppress non-error output to stderr',
  });

  override async execute(): Promise<number> {
    const writer = new OutputWriter({
      stdout: this.context.stdout,
      stderr: this.context.stderr,
      json: this.json,
    });
    try {
      const summary = await this.run();
      this.emit(writer, summary);
      return 0;
    } catch (err) {
      return writer.error(err);
    }
  }

  private async run(): Promise<SnapshotSummary> {
    const auth = await this.context.deps.resolveAuth({
      shopOverride: this.shop,
      cwd: this.context.deps.cwd(),
      homeDir: this.context.deps.homeDir(),
      processEnv: this.context.deps.env(),
    });

    const scope = parseScope(this.scope);

    if (!this.quiet && !this.json) {
      const ts = this.context.deps.now().toISOString();
      this.context.stderr.write(`Capturing snapshot of ${auth.shopDomain} at ${ts}\n`);
    }

    const client = this.context.deps.buildClient({
      credentials: {
        shopDomain: auth.shopDomain,
        clientId: auth.clientId,
        clientSecret: auth.clientSecret,
      },
      ...(auth.apiVersion ? { apiVersion: auth.apiVersion } : {}),
    });

    if (scope.metaobjects) {
      await assertMetaobjectReadScopes(client, {
        verb: 'Capturing',
        scopeWorkaround: 'products,collections,metafields,inventory-levels',
      });
    }

    const snapshotWriter = this.context.deps.buildWriter(auth.shopDomain, this.baseDir);
    await snapshotWriter.start();
    const releaseInterrupt =
      this.context.deps.onInterrupt?.(async () => {
        await snapshotWriter.abort();
        this.context.stderr.write('fallback: Interrupted. The partial snapshot was removed.\n');
      }) ?? (() => {});

    try {
      const productIds: string[] = [];
      const variantIds: string[] = [];
      const collectionIds: string[] = [];

      // Products are iterated whenever metafields is in scope, even if --scope excludes
      // products: metafields are owner-scoped, so the products fetch is how we get the
      // product and variant IDs that drive the owner queries. Same for collections below.
      if (scope.products || scope.metafields) {
        let iter = this.context.deps.fetchers.products(client);
        iter = teeKeys(iter, (r) => r.product.id, productIds);
        if (scope.metafields) {
          iter = teeVariantIds(iter, variantIds);
        }
        if (scope.products) {
          await snapshotWriter.writeProducts(iter);
        } else {
          for await (const _ of iter) void _;
        }
      }

      if (scope.collections || scope.metafields) {
        let iter = this.context.deps.fetchers.collections(client);
        iter = teeKeys(iter, (c) => c.id, collectionIds);
        if (scope.collections) {
          await snapshotWriter.writeCollections(iter);
        } else {
          for await (const _ of iter) void _;
        }
      }

      if (scope.metafields) {
        await snapshotWriter.writeMetafields(
          concatIterables(
            this.context.deps.fetchers.metafields(client, productIds),
            this.context.deps.fetchers.variantMetafields(client, variantIds),
            this.context.deps.fetchers.collectionMetafields(client, collectionIds),
            this.context.deps.fetchers.shopMetafields(client),
          ),
        );
        await snapshotWriter.writeMetafieldDefinitions(
          this.context.deps.fetchers.metafieldDefinitions(client, CONTENT_METAFIELD_OWNER_TYPES),
        );
      }

      if (scope.metaobjects) {
        const definitionTypes: string[] = [];
        await snapshotWriter.writeMetaobjectDefinitions(
          teeKeys(this.context.deps.fetchers.metaobjectDefinitions(client), (d) => d.type, definitionTypes),
        );
        await snapshotWriter.writeMetaobjects(
          this.context.deps.fetchers.metaobjects(client, definitionTypes),
        );
      }

      if (scope.inventoryLevels) {
        await snapshotWriter.writeInventoryLevels(
          this.context.deps.fetchers.inventoryLevels(client, { allLocations: true }),
        );
      }

      const result = await snapshotWriter.finish(scope, {
        apiVersion: auth.apiVersion ?? SHOPIFY_API_VERSION,
      });
      return { ...result, shop: auth.shopDomain, scope };
    } catch (err) {
      try {
        await snapshotWriter.abort();
      } catch {
        // An abort failure must never mask the original capture error.
      }
      throw err;
    } finally {
      releaseInterrupt();
    }
  }

  private emit(writer: OutputWriter, summary: SnapshotSummary): void {
    if (this.json) {
      writer.json(summary);
      return;
    }
    if (this.quiet) return;
    writer.human(formatSnapshotSummary(summary));
  }
}

async function* teeVariantIds(
  iter: AsyncIterable<ProductRecord>,
  ids: string[],
): AsyncIterable<ProductRecord> {
  for await (const item of iter) {
    for (const v of item.variants) ids.push(v.id);
    yield item;
  }
}

const VALID_SCOPES = [
  'products',
  'collections',
  'metafields',
  'inventory-levels',
  'metaobjects',
] as const;

export function parseScope(input: string | undefined): ScopeFlags {
  if (input === undefined) {
    return {
      products: true,
      collections: true,
      metafields: true,
      inventoryLevels: true,
      metaobjects: true,
    };
  }
  const parts = input
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) {
    throw new ScopeError('--scope requires at least one resource (e.g. products,collections).');
  }
  const invalid = parts.filter((p) => !(VALID_SCOPES as readonly string[]).includes(p));
  if (invalid.length > 0) {
    throw new ScopeError(
      `Unknown --scope value(s): ${invalid.join(', ')}. Allowed: ${VALID_SCOPES.join(', ')}.`,
    );
  }
  return {
    products: parts.includes('products'),
    collections: parts.includes('collections'),
    metafields: parts.includes('metafields'),
    inventoryLevels: parts.includes('inventory-levels'),
    metaobjects: parts.includes('metaobjects'),
  };
}
