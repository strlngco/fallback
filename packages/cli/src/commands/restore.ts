// packages/cli/src/commands/restore.ts
import { join } from 'node:path';
import { Command, Option, type BaseContext } from 'clipanion';

import {
  RestorePlanSchema,
  RestoreResultSchema,
  buildRestorePlan,
  manifestMetafieldOwnerTypes,
  type ManifestScope,
  type RestoreOperation,
  type RestoreOperationResult,
  type RestorePlan,
  type RestoreResult,
} from '@strlngco/fallback-core';
import {
  ShopifyUserError,
  type ScopedRequester,
  type ShopifyClientOptions,
} from '@strlngco/fallback-shopify';

import { ScopeError, type ResolveAuthOptions, type ResolvedAuth } from '../env';
import {
  computeSnapshotDiff,
  loadManifest,
  type DiffFetchers,
} from '../diff/compute';
import { defaultBaseDir } from '../output/paths';
import { OutputWriter } from '../output/writer';
import { formatRestorePlan, formatRestorePlanSummary, formatRestoreResult } from '../output/format/restore';
import { RESTORE_PLAN_CONFIG, RESTORE_RESOURCE_KEYS } from '../restore/config';
import { assertMetaobjectReadScopes } from '../scope-preflight';
import { parseScope } from './snapshot';
import type { ScopeFlags } from '../snapshot/writer';

// write_products covers metafield values on every owner type Fallback captures
// (product, variant, collection, shop) — verified live against 2026-04 with the
// app's own client-credentials token.
const WRITE_SCOPES_BY_RESOURCE = {
  products: 'write_products',
  metafields: 'write_products',
  metaobjects: 'write_metaobjects',
} as const;

function requiredWriteScopes(scope: ScopeFlags): string[] {
  const required = new Set<string>();
  if (scope.products) required.add(WRITE_SCOPES_BY_RESOURCE.products);
  if (scope.metafields) required.add(WRITE_SCOPES_BY_RESOURCE.metafields);
  if (scope.metaobjects) required.add(WRITE_SCOPES_BY_RESOURCE.metaobjects);
  return [...required];
}

async function assertWriteScopes(client: ScopedRequester, scope: ScopeFlags): Promise<void> {
  const granted = await client.getGrantedScopes();
  const missing = requiredWriteScopes(scope).filter((s) => !granted.includes(s));
  if (missing.length === 0) return;
  throw new ScopeError(
    `Restore requires the ${missing.join(' and ')} access scope${missing.length > 1 ? 's' : ''}, ` +
      `but the app was granted: ${granted.length > 0 ? granted.join(', ') : 'none'}. ` +
      `Grant ${missing.length > 1 ? 'them' : 'it'} in the Shopify Dev Dashboard and retry.`,
  );
}

export interface RestoreMutators {
  restoreProduct: (client: ScopedRequester, op: RestoreOperation) => Promise<void>;
  restoreMetafields: (client: ScopedRequester, ops: RestoreOperation[]) => Promise<void>;
  restoreMetaobject: (client: ScopedRequester, op: RestoreOperation) => Promise<void>;
}

export interface RestoreDependencies {
  buildClient: (opts: ShopifyClientOptions) => ScopedRequester;
  fetchers: DiffFetchers;
  mutators: RestoreMutators;
  resolveAuth: (opts: ResolveAuthOptions) => Promise<ResolvedAuth>;
  now: () => Date;
  cwd: () => string;
  homeDir: () => string;
  env: () => Record<string, string | undefined>;
}

export interface RestoreContext extends BaseContext {
  deps: RestoreDependencies;
}

export class RestoreCommand extends Command<RestoreContext> {
  static override paths = [['restore']];

  static override usage = Command.Usage({
    description: 'Restore drifted records to a captured snapshot (dry-run by default).',
    details: `
      Recomputes the diff between the snapshot and current store state, then re-applies the
      snapshot's values to records that have drifted (products, variants, metafield
      values on product, variant, collection, and shop owners, and metaobject field values). Shopify-managed and app-owned metafield and
      metaobject namespaces are skipped. Dry-run by default: prints the plan and writes
      nothing. Pass --apply to perform the writes. Requires the write_products access scope,
      and write_metaobjects when the resolved scope includes metaobjects.
    `,
    examples: [
      ['Preview a restore', 'fallback restore 2026-05-29T04-24-50Z'],
      ['Apply a restore', 'fallback restore 2026-05-29T04-24-50Z --apply'],
      ['Restore only metafields', 'fallback restore 2026-05-29T04-24-50Z --scope metafields --apply'],
    ],
  });

  snapshotId = Option.String();
  shop = Option.String('--shop', { description: 'Shop domain override' });
  scope = Option.String('--scope', {
    description: 'Comma-separated subset of restorable resources: products, metafields, metaobjects',
  });
  baseDir = Option.String('--base-dir', { description: 'Override the snapshot base directory' });
  apply = Option.Boolean('--apply', false, { description: 'Perform the writes (default is dry-run)' });
  json = Option.Boolean('--json', false, { description: 'Emit the plan or result as JSON to stdout' });
  summaryOnly = Option.Boolean('--summary-only', false, { description: 'Print only counts to stderr' });

  override async execute(): Promise<number> {
    const writer = new OutputWriter({
      stdout: this.context.stdout,
      stderr: this.context.stderr,
      json: this.json,
    });
    try {
      return await this.run(writer);
    } catch (err) {
      return writer.error(err);
    }
  }

  private async run(writer: OutputWriter): Promise<number> {
    const auth = await this.context.deps.resolveAuth({
      shopOverride: this.shop,
      cwd: this.context.deps.cwd(),
      homeDir: this.context.deps.homeDir(),
      processEnv: this.context.deps.env(),
    });

    const baseDir = this.baseDir ?? defaultBaseDir(this.context.deps.homeDir());
    const snapshotDir = join(baseDir, auth.shopDomain, this.snapshotId);
    const manifest = await loadManifest(snapshotDir, this.snapshotId);
    const scope = resolveRestoreScope(this.scope, manifest.scope);

    const client = this.context.deps.buildClient({
      credentials: {
        shopDomain: auth.shopDomain,
        clientId: auth.clientId,
        clientSecret: auth.clientSecret,
      },
      ...(auth.apiVersion ? { apiVersion: auth.apiVersion } : {}),
    });

    // Dry-run writes nothing, so it needs only read scopes — previewing a restore
    // plan must not require granting write access. --apply checks the write scopes
    // for the resolved --scope first, before any fetch. The metaobject READ check
    // runs on dry-run too: Shopify silently returns empty results without those
    // scopes, which would misreport every metaobject as deleted.
    if (scope.metaobjects) {
      await assertMetaobjectReadScopes(client, {
        verb: 'Restoring',
        scopeWorkaround: 'products,metafields',
      });
    }
    if (this.apply) await assertWriteScopes(client, scope);

    const diff = await computeSnapshotDiff({
      snapshotDir,
      snapshotId: this.snapshotId,
      shop: auth.shopDomain,
      scope,
      client,
      fetchers: this.context.deps.fetchers,
      showIgnored: false,
      now: this.context.deps.now,
      metafieldOwnerTypes: manifestMetafieldOwnerTypes(manifest.scope),
      hasMetafieldDefinitions: manifest.scope.metafieldOwnerTypes !== undefined,
    });

    const plan = buildRestorePlan({
      snapshotId: this.snapshotId,
      shop: auth.shopDomain,
      builtAt: this.context.deps.now().toISOString(),
      diff,
      config: RESTORE_PLAN_CONFIG,
    });

    if (!this.apply) {
      this.emitPlan(writer, plan);
      return 0;
    }

    const result = await this.applyPlan(client, plan, auth.shopDomain);
    this.emitResult(writer, result);
    return result.counts.failed > 0 ? 2 : 0;
  }

  private async applyPlan(
    client: ScopedRequester,
    plan: RestorePlan,
    shop: string,
  ): Promise<RestoreResult> {
    const results: RestoreOperationResult[] = [];

    const productOps = plan.operations.filter((op) => op.resource === 'products');
    for (const op of productOps) {
      try {
        await this.context.deps.mutators.restoreProduct(client, op);
        results.push({ resource: 'products', id: op.id, status: 'restored' });
      } catch (err) {
        results.push({ resource: 'products', id: op.id, status: 'failed', error: messageOf(err) });
      }
    }

    const metafieldOps = plan.operations.filter((op) => op.resource === 'metafields');
    for (const batch of chunk(metafieldOps, 25)) {
      try {
        await this.context.deps.mutators.restoreMetafields(client, batch);
        for (const op of batch) results.push({ resource: 'metafields', id: op.id, status: 'restored' });
      } catch (err) {
        // metafieldsSet is atomic, so one rejected value fails the whole batch, and
        // a deterministic plan would rebuild the same batch on every re-run. Retrying
        // one at a time isolates the rejected metafield. Other errors (network, auth)
        // would fail each retry the same way, so they are reported for the batch.
        if (!(err instanceof ShopifyUserError) || batch.length === 1) {
          const message = messageOf(err);
          for (const op of batch) {
            results.push({ resource: 'metafields', id: op.id, status: 'failed', error: message });
          }
          continue;
        }
        for (const op of batch) {
          try {
            await this.context.deps.mutators.restoreMetafields(client, [op]);
            results.push({ resource: 'metafields', id: op.id, status: 'restored' });
          } catch (singleErr) {
            results.push({ resource: 'metafields', id: op.id, status: 'failed', error: messageOf(singleErr) });
          }
        }
      }
    }

    const metaobjectOps = plan.operations.filter((op) => op.resource === 'metaobjects');
    for (const op of metaobjectOps) {
      try {
        await this.context.deps.mutators.restoreMetaobject(client, op);
        results.push({ resource: 'metaobjects', id: op.id, status: 'restored' });
      } catch (err) {
        results.push({ resource: 'metaobjects', id: op.id, status: 'failed', error: messageOf(err) });
      }
    }

    const skippedCount =
      plan.skipped.created.length + plan.skipped.deleted.length + plan.skipped.unsupported.length;

    return {
      snapshotId: plan.snapshotId,
      shop,
      appliedAt: this.context.deps.now().toISOString(),
      results,
      skipped: plan.skipped,
      counts: {
        restored: results.filter((r) => r.status === 'restored').length,
        failed: results.filter((r) => r.status === 'failed').length,
        skipped: skippedCount,
      },
    };
  }

  private emitResult(writer: OutputWriter, result: RestoreResult): void {
    if (this.json) {
      RestoreResultSchema.parse(result);
      writer.json(result);
    } else {
      writer.human(formatRestoreResult(result));
    }
  }

  private emitPlan(writer: OutputWriter, plan: RestorePlan): void {
    if (this.json) {
      RestorePlanSchema.parse(plan);
      writer.json(plan);
    } else if (this.summaryOnly) {
      writer.human(formatRestorePlanSummary(plan));
    } else {
      writer.human(formatRestorePlan(plan));
    }
  }
}

export function resolveRestoreScope(
  input: string | undefined,
  manifestScope: ManifestScope,
): ScopeFlags {
  if (input === undefined) {
    return {
      products: manifestScope.products,
      collections: false,
      metafields: manifestScope.metafields,
      inventoryLevels: false,
      metaobjects: manifestScope.metaobjects === true,
    };
  }

  const requested = parseScope(input);
  const unsupported: string[] = [];
  if (requested.collections) unsupported.push('collections');
  if (requested.inventoryLevels) unsupported.push('inventory-levels');
  if (unsupported.length > 0) {
    throw new ScopeError(
      `restore supports only ${[...RESTORE_RESOURCE_KEYS].join(', ')}; not: ${unsupported.join(', ')}.`,
    );
  }
  const missing: string[] = [];
  if (requested.products && !manifestScope.products) missing.push('products');
  if (requested.metafields && !manifestScope.metafields) missing.push('metafields');
  if (requested.metaobjects && manifestScope.metaobjects !== true) missing.push('metaobjects');
  if (missing.length > 0) {
    throw new ScopeError(
      `--scope requested resources not captured in this snapshot: ${missing.join(', ')}.`,
    );
  }
  return {
    products: requested.products,
    collections: false,
    metafields: requested.metafields,
    inventoryLevels: false,
    metaobjects: requested.metaobjects,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
