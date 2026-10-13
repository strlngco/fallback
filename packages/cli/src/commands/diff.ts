import { join } from 'node:path';
import { Command, Option } from 'clipanion';

import {
  SnapshotDiffSchema,
  manifestMetafieldOwnerTypes,
  type SnapshotDiff,
} from '@strlngco/fallback-core';

import { defaultBaseDir } from '../output/paths';
import { formatDiffHuman, formatDiffSummary } from '../output/format/diff';
import { OutputWriter } from '../output/writer';
import { assertMetaobjectReadScopes } from '../scope-preflight';
import { type SnapshotContext } from './snapshot';
import { computeSnapshotDiff, loadManifest, resolveDiffScope } from '../diff/compute';

export class DiffCommand extends Command<SnapshotContext> {
  static override paths = [['diff']];

  static override usage = Command.Usage({
    description: 'Diff the current Shopify store against a captured snapshot.',
    details: `
      Reads the snapshot identified by the positional snapshotId argument and compares it
      to current store state via the Admin API. Reports created, updated, and deleted
      records per resource type. Exit code is 0 whether or not a diff exists — diff
      output is informational.
    `,
    examples: [
      ['Diff against a snapshot', 'fallback diff 2026-05-29T04-24-50Z'],
      [
        'Diff a subset of resources captured in the snapshot',
        'fallback diff 2026-05-29T04-24-50Z --scope products,collections',
      ],
      ['Emit the full diff as JSON', 'fallback diff 2026-05-29T04-24-50Z --json'],
      [
        'Print only per-resource counts',
        'fallback diff 2026-05-29T04-24-50Z --summary-only',
      ],
    ],
  });

  snapshotId = Option.String();
  shop = Option.String('--shop', {
    description: 'Shop domain override (e.g. example.myshopify.com)',
  });
  scope = Option.String('--scope', {
    description: 'Comma-separated subset of resources to diff (must be a subset of the snapshot scope)',
  });
  baseDir = Option.String('--base-dir', {
    description: 'Override the snapshot base directory (default ~/.fallback/snapshots)',
  });
  json = Option.Boolean('--json', false, {
    description: 'Emit the full SnapshotDiff as JSON to stdout',
  });
  summaryOnly = Option.Boolean('--summary-only', false, {
    description: 'Print only per-resource counts to stderr',
  });
  showIgnored = Option.Boolean('--show-ignored', false, {
    description: 'Include changes normally suppressed as noise (timestamps, variant positions, option value reorder)',
  });
  withReport = Option.Boolean('--with-report', false, {
    description: 'With --json, also render the human-readable report to stderr from the same diff (no second fetch)',
  });

  override async execute(): Promise<number> {
    const writer = new OutputWriter({
      stdout: this.context.stdout,
      stderr: this.context.stderr,
      json: this.json,
    });
    try {
      const { diff } = await this.run();
      this.emit(writer, diff);
      return 0;
    } catch (err) {
      return writer.error(err);
    }
  }

  private async run(): Promise<{ diff: SnapshotDiff; snapshotDir: string }> {
    const auth = await this.context.deps.resolveAuth({
      shopOverride: this.shop,
      cwd: this.context.deps.cwd(),
      homeDir: this.context.deps.homeDir(),
      processEnv: this.context.deps.env(),
    });

    const baseDir = this.baseDir ?? defaultBaseDir(this.context.deps.homeDir());
    const snapshotDir = join(baseDir, auth.shopDomain, this.snapshotId);

    const manifest = await loadManifest(snapshotDir, this.snapshotId);
    const scope = resolveDiffScope(this.scope, manifest.scope);

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
        verb: 'Diffing',
        scopeWorkaround: 'products,collections,metafields,inventory-levels',
      });
    }

    const diff = await computeSnapshotDiff({
      snapshotDir,
      snapshotId: this.snapshotId,
      shop: auth.shopDomain,
      scope,
      client,
      fetchers: this.context.deps.fetchers,
      showIgnored: this.showIgnored,
      now: this.context.deps.now,
      metafieldOwnerTypes: manifestMetafieldOwnerTypes(manifest.scope),
      hasMetafieldDefinitions: manifest.scope.metafieldOwnerTypes !== undefined,
    });

    return { diff, snapshotDir };
  }

  private emit(writer: OutputWriter, diff: SnapshotDiff): void {
    if (this.json) {
      SnapshotDiffSchema.parse(diff);
      // Render before writing so a formatter failure surfaces as a clean error
      // rather than valid JSON followed by a crash.
      const report = this.withReport
        ? formatDiffHuman(diff, { showIgnored: this.showIgnored })
        : null;
      writer.json(diff);
      if (report !== null) writer.human(report);
    } else if (this.summaryOnly) {
      writer.human(formatDiffSummary(diff));
    } else {
      writer.human(formatDiffHuman(diff, { showIgnored: this.showIgnored }));
    }
  }
}
