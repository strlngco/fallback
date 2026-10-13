import { homedir } from 'node:os';

import { Builtins, Cli, type BaseContext, type CommandClass } from 'clipanion';

import {
  ShopifyClient,
  fetchCollectionMetafields,
  fetchCollections,
  fetchInventoryLevels,
  fetchMetafieldDefinitions,
  fetchMetaobjectDefinitions,
  fetchMetaobjects,
  fetchProductMetafields,
  fetchProducts,
  fetchShopMetafields,
  fetchVariantMetafields,
  restoreMetafields,
  restoreMetaobject,
  restoreProduct,
} from '@strlngco/fallback-shopify';

import { DiffCommand } from './commands/diff';
import { ListCommand } from './commands/list';
import { RestoreCommand, type RestoreDependencies } from './commands/restore';
import {
  SnapshotCommand,
  type SnapshotDependencies,
} from './commands/snapshot';
import { resolveAuth } from './env';
import { nextStep, readLocalState, shouldShowNextStep } from './output/next-step';
import { SnapshotWriter } from './snapshot/writer';
import { FALLBACK_VERSION } from './version';

type FallbackContext = BaseContext & {
  deps: SnapshotDependencies & RestoreDependencies;
};

const cli = new Cli<FallbackContext>({
  binaryLabel: 'fallback',
  binaryName: 'fallback',
  binaryVersion: FALLBACK_VERSION,
});

// Each command declares a Context typed to only the dependency subset it uses
// (SnapshotContext, RestoreContext) rather than FallbackContext, so its tests can
// build small dependency fixtures instead of the full merged object below. clipanion
// types Cli#register as CommandClass<Context> for the Cli's own Context, invariantly:
// a command typed Command<SnapshotContext> is not structurally a
// CommandClass<FallbackContext> even though every field it reads is present on the
// `deps` object actually threaded through at runtime. One cast here, rather than one
// per registration. The generic constraint ensures tsc rejects commands whose deps are
// not a subset of FallbackContext's deps, providing a compile-time backstop.
function registerCommand<Deps extends Partial<FallbackContext['deps']>>(
  commandClass: CommandClass<BaseContext & { deps: Deps }>,
): void {
  cli.register(commandClass as unknown as CommandClass<FallbackContext>);
}

cli.register(Builtins.HelpCommand);
cli.register(Builtins.VersionCommand);
registerCommand(SnapshotCommand);
registerCommand(ListCommand);
registerCommand(DiffCommand);
registerCommand(RestoreCommand);

const deps: SnapshotDependencies & RestoreDependencies = {
  buildClient: (opts) => new ShopifyClient(opts),
  buildWriter: (shop, baseDir) => new SnapshotWriter(shop, baseDir),
  fetchers: {
    products: fetchProducts,
    collections: fetchCollections,
    metafields: fetchProductMetafields,
    variantMetafields: fetchVariantMetafields,
    collectionMetafields: fetchCollectionMetafields,
    shopMetafields: fetchShopMetafields,
    metafieldDefinitions: fetchMetafieldDefinitions,
    metaobjectDefinitions: fetchMetaobjectDefinitions,
    metaobjects: fetchMetaobjects,
    inventoryLevels: fetchInventoryLevels,
  },
  mutators: {
    restoreProduct,
    restoreMetafields,
    restoreMetaobject,
  },
  resolveAuth,
  onInterrupt: (handler) => {
    // 128 + signal number, the shell convention for death by signal.
    const listener = (signal: NodeJS.Signals) => {
      void handler().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
    };
    process.once('SIGINT', listener);
    process.once('SIGTERM', listener);
    return () => {
      process.off('SIGINT', listener);
      process.off('SIGTERM', listener);
    };
  },
  now: () => new Date(),
  cwd: () => process.cwd(),
  homeDir: () => homedir(),
  env: () => ({ ...process.env }),
};

const argv = process.argv.slice(2);

if (shouldShowNextStep(argv, { stdout: process.stdout, stdin: process.stdin })) {
  const state = await readLocalState({
    cwd: deps.cwd(),
    homeDir: deps.homeDir(),
    processEnv: deps.env(),
  });
  process.stderr.write(nextStep(state) + '\n');
  process.exit(0);
}

await cli.runExit(argv, {
  ...Cli.defaultContext,
  deps,
});
