# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- `diff` and `restore` name the store on their first line (`Diffing
  <store> against snapshot <id>`, `Restoring <store> to snapshot <id>`)
  before they fetch or write anything, so a `.env` in the working
  directory that points at another store is visible at once. `--json`
  output is unchanged.
- `diff` and `restore` list records in ID order, with numbers compared as
  numbers, so the same changes always print in the same order, in the
  human report and in `--json` output.

### Fixed

- When a product is only partly restored (its product fields or a first
  batch of variants were written before a later call failed), `restore
  --apply` now says what was written, in the report and as a `written`
  list on the failed result in `--json` output. Running `restore` again
  writes only what is still different.
- `.env` files accept `export KEY=value` lines and trailing `# comments`
  after unquoted values. A `#` inside quotes, or inside an unquoted value
  with no space before it, is kept.

## [1.0.1] — 2026-10-13

First release on npm, as `@strlngco/fallback`. The command is still
`fallback`.

### Changed

- Published as `@strlngco/fallback`; the unscoped npm name belongs to an
  unrelated package. Install with `npm install -g @strlngco/fallback`.
- The CLI bundles its internal packages, so it installs with no workspace
  dependencies, and no longer depends on cosmiconfig.
- The README now walks first-time command-line users through installation,
  app setup, and a first snapshot, diff, and restore. Screenshots are replaced
  by terminal text.

### Fixed

- `restore` now restores variant SKU drift. SKU was listed as covered, but its
  drift was skipped as unsupported and `--apply` exited 0 with the SKU unchanged.
- The restore plan shows each change in the direction it is written, current
  value → snapshot value. It previously showed the drifted value as the target,
  in both the dry-run text and `restore --json`; the writes were always correct.
- A metafield Shopify rejects during `restore --apply` no longer fails the
  other metafields sent in the same batch.
- The shop domain must be a `*.myshopify.com` domain and `SHOPIFY_API_VERSION`
  must look like `2026-04`. Other values exit 1 before any request, instead of
  sending credentials to an arbitrary host or writing outside the snapshot
  directory.
- `diff` and `restore` reject a snapshot id that is not in snapshot id format.
- Requests time out after 60 seconds instead of hanging, and network errors,
  timeouts, and 5xx responses are retried. A 429's `Retry-After` is honoured.
- An unreachable store is reported as "Could not reach …" with exit 2, not as
  a credentials rejection with exit 1.
- Two snapshots started in the same second no longer share, overwrite, or
  delete each other's files; the second fails up front.
- Ctrl-C or SIGTERM during `snapshot` removes the partial snapshot.
- A disk error during `snapshot` fails cleanly with exit 2 instead of crashing,
  and `manifest.json` is written atomically.
- The manifest records the API version actually used when
  `SHOPIFY_API_VERSION` overrides the default.
- The scheduled sentinel captures a new baseline when `SENTINEL_SCOPE` widens
  beyond what its latest snapshot covers, instead of failing every day.
- `restore --help` lists every metafield owner restore covers, and a `diff`
  missing metaobject scopes no longer calls itself "Capturing".

## 1.0.0 — 2026-08-23

First stable release. The command surface — `snapshot`, `list`, `diff`,
`restore` — and the snapshot file format are now stable: 1.x will not break
them. New capabilities may still arrive as additive minor releases.

No functional changes since 0.4.4. This release marks the surface as stable
after sustained unattended daily operation of the scheduled sentinel against
a production store.

## 0.4.4 — 2026-08-22

### Added

- `diff --json --with-report` renders the human report to stderr from the
  same diff that produces the JSON, so one call yields both.

### Fixed

- The scheduled sentinel renders its drift report from the diff it already
  captured instead of re-running `diff` a second time. The redundant second
  live fetch doubled the per-drift API load and added a failure surface whose
  error was discarded as a generic "(report render failed)" — a transient
  fetch or throttle error was indistinguishable from a real render bug and
  never reached the log. It now uses `diff --json --with-report`, so a diff
  failure surfaces its real error.

## 0.4.3 — 2026-07-08

### Fixed

- Variant inventory quantities no longer count as product drift in `diff`.
  Quantities move with every legitimate sale and have their own resource
  (`inventory-levels`) when tracking them is wanted; a production sale was
  filing a false daily drift report. Still visible with `--show-ignored`.
- The scheduled sentinel's drift reports now print a deep-dive command that
  is runnable as-is in the worker's shell (full CLI path, `--scope`, and
  `--base-dir`).

## 0.4.2 — 2026-07-08

### Fixed

- A failed snapshot capture now removes its partial directory instead of
  leaving a manifest-less snapshot behind. Such leftovers broke every later
  `list` and `diff` against them, and pinned the scheduled sentinel to a
  daily failure until removed by hand.
- The scheduled sentinel skips snapshots marked broken when picking its
  baseline, so an interrupted capture degrades to re-baselining instead of
  failing every day.

## 0.4.1 — 2026-07-08

### Fixed

- Products with statuses beyond the original enum (such as `UNLISTED`, added
  by Shopify in 2025-10) no longer fail snapshot capture. Product status now
  parses as an extensible string per the schema forward-compatibility rule;
  restore round-trips any status value unchanged. Found by the scheduled
  sentinel's first production run.

## 0.4.0 — 2026-07-06

### Added

- Restore now re-applies drifted metaobject field values (`--scope metaobjects`)
  and metafield values on variant, collection, and shop owners, using the same
  dry-run-by-default model as product restore. `--apply` with metaobjects in
  scope requires the `write_metaobjects` access scope.

### Changed

- Values in Shopify-managed namespaces (`shopify`, `shopify--*`) and app-owned
  namespaces (`app--*`) are reported as skipped during restore, never written.
- Metafield and metaobject definition drift is reported as skipped
  (definitions are not restorable).

## 0.3.0 — 2026-07-04

### Added

- Snapshot and diff coverage for metaobject entries and definitions (`--scope metaobjects`).
- Snapshot and diff coverage for metafield definitions and for metafields on
  variant, collection, and shop owners (captured under `--scope metafields`).
- Snapshot manifests record metafield owner coverage so diffs against older
  snapshots compare exactly what those snapshots captured.

### Changed

- `fallback snapshot` without `--scope` now also captures metaobjects and
  requires the `read_metaobjects` and `read_metaobject_definitions` scopes.
- Restore reports non-product metafields and metaobjects as skipped; content
  restore ships in a later release.
- Snapshot and diff fail fast with an actionable error when metaobjects are in
  scope but the app lacks the required read scopes. Shopify returns empty
  results rather than an access error for these queries, so without the check
  a snapshot would silently claim coverage it does not have.

## 0.2.0 — 2026-07-02

### Added

- `fallback restore <snapshot-id>` — re-applies a snapshot to drifted products,
  variants, and product metafields. Dry-run by default (read-only); `--apply`
  writes and requires the `write_products` access scope.
- A passive, state-aware next-step line on a bare `fallback` invocation at an
  interactive terminal (no network; reads only local snapshots and env).

### Changed

- Internal: all command output now routes through a single `cli/src/output`
  layer (output-mode gate, stream/margin-owning writer, pure per-command
  formatters, shared error mapping). No change to `--json`, piped, or non-TTY
  output — locked by byte-stable tests.

## 0.1.0 — 2026-06-01

Initial release, distributed from source and not tagged.

### Added

- `fallback snapshot` captures products with variants, prices, and inventory
  per location, custom and smart collections, and product metafields into a
  timestamped local directory with a manifest.
- `fallback list` shows local snapshots with scope, counts, and size, and
  surfaces broken snapshots rather than hiding them.
- `fallback diff <snapshot-id>` compares a snapshot to the live store, field by
  field, with stable identity for variants and collection members, and a
  `--json` mode for machine consumption.
- Authentication through Shopify's client credentials grant for Dev Dashboard
  apps; the access token is never written to disk.

[Unreleased]: https://github.com/strlngco/fallback/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/strlngco/fallback/releases/tag/v1.0.1
