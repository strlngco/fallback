# Scheduled sentinel

`scripts/sentinel.mjs` runs Fallback on a schedule against one store, using a
read-only Shopify app. `scripts/sentinel-loop.mjs` is the scheduler that
keeps it running on Render. This is the runbook for standing that up.

## Purpose

On a multi-user storefront, catalog changes happen every day — a merchandiser
edits a description, an app updates inventory, an agent runs a bulk price
change — and Shopify keeps no ledger of it. The admin's `updatedAt` timestamp
and activity log don't reconstruct what moved. The sentinel turns Fallback
into that ledger: a daily report of what changed since yesterday, with
`fallback restore` as the rollback when a change turns out to be one that
should not have happened.

Most drift is intended. The report's job is visibility, not anomaly
detection — it does not judge whether a change was correct, only that it
happened and exactly what it was.

## How it works

Each run compares the store to the most recent snapshot on disk (a rolling
baseline), then takes a fresh snapshot so the next run has something current
to diff against. A run whose diff fails does not take that fresh snapshot, so
the failure repeats until its cause is fixed rather than being papered over
by a new baseline. The first run for a store has no baseline yet, so it just
captures one.

The baseline is the most recent snapshot that captured everything in
`SENTINEL_SCOPE`. If you widen the scope (adding `inventory-levels`, say), no
existing snapshot covers it, so the next run captures a new baseline and logs
`BASELINE RESET` instead of diffing.

Inventory levels are excluded from the default scope (`products`,
`collections`, `metafields`, `metaobjects`) because they move with every
sale and would drown the report in noise. Set `SENTINEL_SCOPE` to override —
for example `products,collections,metafields,metaobjects,inventory-levels`
to include them.

Exit codes: `0` on a quiet day (nothing drifted, or this was the first run
and only a baseline was captured), `1` when the diff found drift, `2` when
the sentinel itself failed (missing configuration, a Shopify API error, a
snapshot that could not be written). The log banner tells you which:
`FIRST RUN`, `BASELINE RESET`, `ALL QUIET`, `DRIFT REPORT`, or
`SENTINEL FAILURE`.

One case mixes banners: when the snapshot stage fails after a drift report
was already printed, the log shows `DRIFT REPORT` followed by `SENTINEL
FAILURE` — drift information is never swallowed by a failure. A failure
banner can therefore follow a drift report in the same log; the exit code
(`2`) is authoritative for whether the run broke, not banner order.

A second case mixes exit codes with reporting: on a drift day (`1`), if the
GitHub issue post itself fails, the run's exit code escalates to `2` and the
log gains a trailing `SENTINEL FAILURE — report` banner. An unreachable
report channel must never be silent, even on a day when the rest of the run
succeeded. See "GitHub reporting" below.

## Shopify setup

Create a dedicated app (`fallback-sentinel`, or similar) on the store in the
Dev Dashboard with read scopes only: `read_products`, `read_metaobjects`,
`read_metaobject_definitions` for the default scope, plus `read_inventory`
and `read_locations` so the `SENTINEL_SCOPE` override can include inventory
levels if you ever want it to. Grant no write scopes — this app is
physically unable to change the store, by construction, not by convention.

Install the app to the store and collect its Client ID and Client Secret.

## Render setup

Render's cron jobs cannot attach a persistent disk — disks attach only to
web/private services and Background Workers — and the sentinel needs one for
its rolling snapshot baseline. So it runs as a **Background Worker** with
its own scheduler loop (`scripts/sentinel-loop.mjs`) standing in for cron.

1. New → Background Worker. Connect `strlngco/fallback`, branch `main`.
   Runtime: Node. The repo's `.node-version` pins the version Render builds
   with; a `NODE_VERSION` environment variable on the service overrides it.
   Use 22.23.4, 24.22.1, 26.12.1 or a later release in the same major — the
   earlier releases trust compromised eMudhra intermediates and are open to
   TLS hostname-check bypasses. After changing the version, redeploy with
   Manual Deploy → Clear build cache & deploy.
2. Build command:

   ```bash
   corepack pnpm install --frozen-lockfile && corepack pnpm -r build
   ```

   (`corepack pnpm ...` rather than `corepack enable && pnpm ...`: enable tries
   to write a shim into `/usr/bin`, which is read-only on Render's build image.
   Invoking through corepack still honors the repo's pinned pnpm version.)

3. Start command:

   ```bash
   node scripts/sentinel-loop.mjs
   ```

4. Attach a persistent disk, 1 GB, mounted at `/var/data`. Without a disk
   the filesystem is ephemeral and every snapshot vanishes between restarts,
   which defeats the rolling baseline. At typical catalog sizes the disk
   holds years of dailies; pruning is deferred until the numbers say
   otherwise.
5. Instance type: Starter. Paid instances get a Shell tab on the running
   service, which the rollback procedure below depends on.
6. Environment variables:
   - `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` —
     the read-only sentinel app's credentials from above.
   - `FALLBACK_BASE_DIR=/var/data/snapshots`.
   - `SENTINEL_REPORT_REPO=<owner>/<theme-repo>` — the store's theme repo,
     where drift and failure reports are filed as issues.
   - `SENTINEL_GITHUB_TOKEN` — a fine-grained PAT scoped to that repo. See
     "GitHub reporting" below.
   - Optional: `SENTINEL_RUN_HOUR_UTC` (default `9`, the UTC hour the loop
     runs at daily) and `SENTINEL_SCOPE`.

There is no schedule to configure in Render itself — `sentinel-loop.mjs`
owns the schedule, reading `SENTINEL_RUN_HOUR_UTC` at startup.

## GitHub reporting

Report delivery is per store: the sentinel opens a GitHub issue on the
**store's theme repo**, not the Fallback repo — Fallback stays store-agnostic,
and the theme repo already has the humans who care about this store
watching it. A second store is a second Background Worker, each pointing
`SENTINEL_REPORT_REPO` at its own theme repo; there is no multi-store
fan-out in one process.

GitHub's native issue notifications are the email channel; no separate
notification setup is needed once the repo's watchers are subscribed to
issues.

Issue bodies contain catalog data from the diff: titles, prices, metafield
values. If the theme repo is public, the reports are too. Point
`SENTINEL_REPORT_REPO` at a private repo if that matters for your store.

**PAT setup.** Create a fine-grained personal access token dedicated to this
purpose:

1. Your avatar → Settings (your personal settings, not the org's — an
   org's settings have no Developer settings) → Developer settings →
   Personal access tokens → Fine-grained tokens → Generate new token, or
   go straight to <https://github.com/settings/personal-access-tokens/new>.
2. Resource owner: the theme repo's org. A token owned by your personal
   account can still read a public theme repo but cannot file issues in
   it. If the org requires approval, an org owner approves the token under
   the org's Settings → Personal access tokens → Pending requests.
3. Repository access: only that repo — not all repos in the org.
4. Permissions: Issues — Read and write. Nothing else.
5. Note the expiry date and calendar the renewal. A fine-grained token's
   expiry is mandatory; when it lapses, reporting silently degrades to
   `SENTINEL FAILURE — report` in the Render log (see below), not a
   dramatic failure.

Set the resulting token as `SENTINEL_GITHUB_TOKEN`, redeploy, and check
from a new Shell tab that it can file issues — a read check passes for a
token that cannot write. This opens a test issue; close it afterwards:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "Authorization: Bearer $SENTINEL_GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/$SENTINEL_REPORT_REPO/issues \
  -d '{"title":"Sentinel token test — safe to close","body":"Checking SENTINEL_GITHUB_TOKEN can file reports."}'
```

`201` means reports will arrive. `404` means the token cannot see the repo:
check `SENTINEL_REPORT_REPO`, the token's resource owner, and whether an org
owner revoked or has yet to approve it. `401` means the shell has a stale or
invalid token.

**Issue titles** name the shop and the run date:
`Fallback drift report — <shop> — <isoDate>` on a drift day,
`Fallback sentinel failure — <shop> — <isoDate>` on an operational failure.
The body is the run's full log in a fenced code block.

**Quiet days post nothing** — no issue, no notification, matching the exit
code `0` case exactly.

**A failed post** — the GitHub API rejecting the issue, the token expiring,
the repo being wrong — surfaces as `SENTINEL FAILURE — report` in the
Render log, and only there: it is the one problem class that produces
neither an issue nor an email. If issues stop arriving and the store is
still active, check the Render log for that banner before assuming
everything is quiet.

If `SENTINEL_REPORT_REPO` or `SENTINEL_GITHUB_TOKEN` is unset, the sentinel
runs in log-only mode: no issue is ever posted, and drift/failure are only
visible in the Render log.

## Reading a report

A drifted run's issue (or log, in log-only mode) has, in order: the banner
line (`=== DRIFT REPORT — <shop> — <snapshotId> ===`), a per-resource
summary with one line per resource that changed (`products: +0 ~2 -0`), the
full `fallback diff` human output beneath it — the same field-level report
you'd get running the command yourself — and a closing `deep dive` line
naming the exact, runnable command for the JSON detail
(`node packages/cli/dist/index.js diff <snapshotId> --scope <scope> --json`,
plus `--base-dir <dir>` when `FALLBACK_BASE_DIR` is set), followed by a
pointer back to this document for rollback.

The GitHub issue is the primary surface for reading a report day to day —
that's where the email notification points. The Render log is the fallback
when reporting itself has failed, or for the initial smoke procedure before
`SENTINEL_REPORT_REPO` is configured.

## Rolling back from a sentinel snapshot

The sentinel's own credentials cannot write, by design — the read-only app
holds no write scope at all. Restoring needs a separate, write-capable app:
`write_products`, plus `write_metaobjects` when the restore scope includes
metaobjects, which it does by default whenever the snapshot captured them.
A missing scope fails `--apply` with a clear error before any write
happens, but that is not a discovery you want to be making mid-incident —
confirm the writeful app has both scopes when you set it up, not when you
need it.

Do not edit the worker's Start Command or persistent environment for a
rollback. A Background Worker **restarts its Start Command whenever it
exits**, so pointing the Start Command at `restore` would rerun the restore
on every restart, and write credentials added to the stored environment
would sit next to a process designed never to hold them.

**Primary procedure: the worker's Shell tab.** Paid instances expose a
Shell tab on the running service in the Render dashboard — an interactive
shell on the same instance, same disk, same deploy, that does not touch the
Start Command or persistent settings. Run the restore there, supplying the
writeful app's credentials as one-off env prefixes so they never enter
Render's stored environment:

Dry run first:

```bash
SHOPIFY_CLIENT_ID=<writeful-id> SHOPIFY_CLIENT_SECRET=<writeful-secret> node packages/cli/dist/index.js restore <snapshotId> --base-dir /var/data/snapshots
```

Read the printed plan, then apply:

```bash
SHOPIFY_CLIENT_ID=<writeful-id> SHOPIFY_CLIENT_SECRET=<writeful-secret> node packages/cli/dist/index.js restore <snapshotId> --base-dir /var/data/snapshots --apply
```

Because the credentials are prefixed to the command rather than exported or
set in the dashboard, they exist only for that shell session and are never
persisted — closing the Shell tab is enough cleanup. Never add write
credentials to the worker's stored environment variables.

**For the cautious: run it from a local machine instead**, keeping write
credentials off Render entirely. Copy the snapshot directory down from the
persistent disk — for example via the Shell tab's file access while the
instance is running — then run the same `restore` command locally against
the copied directory, with the writeful app's credentials in a local
`.env` rather than in Render.

## Troubleshooting

Three symptoms cover most repeated failures.

**Repeated `SENTINEL FAILURE — diff` day after day.** Read the detail line
under the banner first. If it is a Shopify or network error, the cause is
outside the sentinel and the next run after it clears succeeds. If it names
a snapshot file, the latest snapshot's data is likely corrupt. Snapshots with
a missing or invalid manifest are already skipped when choosing a baseline,
so this means a snapshot whose manifest is intact but whose data files are
not. The sentinel never re-baselines after a diff-stage failure by design, so
that snapshot stays the latest one until something intervenes. Recovery: from
the worker's Shell tab, run

```bash
node packages/cli/dist/index.js snapshot --scope products,collections,metafields,metaobjects --base-dir /var/data/snapshots
```

(the read-only app's credentials, already in the worker's environment,
suffice — this is a read and a snapshot write, not a restore), or delete
the corrupt snapshot directory by hand. Either way, the next scheduled run
re-baselines.

**Repeated `FIRST RUN — baseline captured` on every run.** The disk is not
mounted, or `FALLBACK_BASE_DIR` does not point at it, so every run starts
against an empty directory and never sees a prior snapshot. Check the
disk's mount path against the environment variable.

**Repeated `SENTINEL FAILURE — report` with no issues arriving.** The
GitHub side has a problem: the PAT expired or was revoked, `SENTINEL_REPORT_REPO`
is misspelled or points at a repo the token can't reach, or GitHub's API is
down. Read the detail line under the banner in the Render log — it carries
the HTTP status and the first part of GitHub's response body. This is the
one failure mode that produces no issue and no email by construction, so it
is worth checking directly whenever issues seem to have gone quiet on an
otherwise-active store.

## Smoke procedure

Before trusting the schedule, deploy the worker and watch the log. The
run-on-start behavior means the deploy itself is the first trigger: the log
ends with `=== FIRST RUN — baseline captured — <shop> ===` (no prior
baseline exists yet). Use Manual Restart to trigger a second run against
that baseline; with nothing changed in between it ends with
`=== ALL QUIET — <shop> ===` (or a genuine drift report, if something did
change). If a report repo is configured and you want to see the issue path
specifically, either seed a small, reversible drift before the second run,
or trust the failure-path tests in `scripts/sentinel.test.mjs` — the runbook
smoke procedure doesn't need to reproduce it. If the second run also ends
with `FIRST RUN` instead, that is the disk-mount symptom in Troubleshooting
above — resolve it before trusting the schedule. Once both runs look right,
leave it alone and let the loop take over.

## A second store

Set up a second Background Worker with its own Shopify app credentials, its
own `FALLBACK_BASE_DIR`, and its own `SENTINEL_REPORT_REPO` pointing at that
store's theme repo. The script handles exactly one store per invocation by
design — there is no multi-store mode to configure.
