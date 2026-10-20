# Fallback

Deterministic snapshot, diff, and restore for Shopify stores. Run by hand, or standing watch.

## Why this exists

AI agents now have write access to Shopify stores. Claude Code with the Shopify AI Toolkit can edit products. The Shopify connector for Claude exposes tools that create, update, and modify catalog data through conversation. Sidekick runs in every admin. Community MCP servers do similar work with looser guardrails.

None of these tools tell you what they did. The admin shows a single `updatedAt` timestamp and a vague activity log. Theme files have rollback; product data does not.

Fallback is the deterministic layer underneath that uncertainty. Snapshot your store before an AI session. Run a diff after. See exactly what changed, at the field level, with stable identity that survives reorders. Restore the fields that shouldn't have moved. It runs locally, stores snapshots on your disk, and never phones home.

Fallback 1.0 is stable: the command surface and the snapshot file format will not break within the 1.x line.

## One app, two faces

Fallback is one deterministic engine (snapshot, then diff, then restore) with two ways to run it.

- **The tool.** You run it, on your machine or in CI, around risky work. It reads and writes: snapshot before, diff after, restore what drifted. This is Fallback.
- **The monitor.** It runs itself. A small always-on worker snapshots and diffs on a schedule and files a drift ledger you read later. It is read-only by construction. This is Fallback-Sentinel.

|                | The tool (`Fallback`)              | The monitor (`Fallback-Sentinel`)                  |
| -------------- | ---------------------------------- | -------------------------------------------------- |
| Where it runs  | your machine or CI, on demand      | a Render worker, daily, unattended                 |
| Shopify access | read **and** write                 | read-only, no write scope at all                   |
| What it does   | snapshot, diff, restore            | snapshot and diff, then reports                    |
| Output         | your terminal                      | a drift ledger as GitHub issues on your theme repo |
| Do you need it | yes, this is Fallback              | optional                                           |

**The tool works on its own.** The monitor is an add-on you set up only if you want a standing daily record of what changed. Most people start with the tool and never need more.

---

## Quick start

If you already use Node and the command line:

```bash
npm install -g @strlngco/fallback     # Node 20 or later
```

Create a Dev Dashboard app with the [scopes below](#step-4-create-a-shopify-app-for-fallback), install it on your store, put its credentials in `~/.fallback/.env`, then:

```bash
fallback snapshot                     # before the risky work
fallback diff <snapshot-id>           # after: what changed
fallback restore <snapshot-id>        # preview putting it back
fallback restore <snapshot-id> --apply
```

New to the command line? The next section walks through every step.

---

## Getting started, step by step

This takes about fifteen minutes the first time. You type each command shown in a grey box into a terminal and press Enter. Lines starting with `$` show a command you type; the lines after it show what Fallback prints back. Don't type the `$` itself.

### What you need

- A computer running macOS, Windows, or Linux.
- A Shopify store, and permission to create apps for it in the Shopify Dev Dashboard. The store must belong to the same Shopify organization as the app (more on that in step 4).

### Step 1: Open a terminal

A terminal is a window where you type commands instead of clicking.

- **macOS:** press Cmd+Space, type `Terminal`, press Enter.
- **Windows:** press the Windows key, type `PowerShell`, press Enter.
- **Linux:** open your distribution's Terminal app (often Ctrl+Alt+T).

Keep this window open for the rest of the guide.

### Step 2: Install Node.js

Fallback runs on Node.js, version 20 or later. Check whether you already have it:

```bash
node --version
```

If that prints `v20` or higher (for example `v22.11.0`), skip to step 3. If it prints an older version or `command not found`, install Node:

1. Go to [nodejs.org](https://nodejs.org) and download the **LTS** installer for your system.
2. Run the installer and accept the defaults.
3. **Close your terminal and open a new one**, so it picks up the newly installed programs.
4. Run `node --version` again to confirm it prints `v20` or higher.

Installing Node also installs `npm`, the tool used in the next step to install Fallback.

### Step 3: Install Fallback

```bash
npm install -g @strlngco/fallback
```

The `-g` makes `fallback` a command you can run from any folder. Confirm it worked:

```bash
fallback --version
```

This prints the installed version, such as `1.0.1`. If you see `command not found` or an `EACCES` permission error instead, see [If something goes wrong](#if-something-goes-wrong).

### Step 4: Create a Shopify app for Fallback

Fallback talks to your store through a private app that you create. The app holds the permissions (Shopify calls them access scopes); Fallback borrows them through a client ID and secret.

1. Go to the [Shopify Dev Dashboard](https://dev.shopify.com/dashboard/) and sign in with the account that owns your store.
2. Click **Create app** and name it `Fallback`. The app opens on its **Overview** page.
3. In the **Versions** card, click **New version**. On the **Create version** page, find **Scopes** under **API access** and paste this line into it:

   ```
   read_products,read_inventory,read_locations,read_metaobjects,read_metaobject_definitions,write_products,write_metaobjects
   ```

   Leave every other field as it is; Fallback doesn't use the URL, POS, or App proxy settings. The **App URL** (`https://example.com` unless you change it) only matters for apps that show a page inside the Shopify admin, and Fallback has none. Scroll to the bottom and click **Release**.

   The read scopes cover `snapshot`, `diff`, `list`, and a restore preview. `write_products` and `write_metaobjects` are used only by `restore --apply`, when you explicitly ask Fallback to change your store. If you want Fallback to be unable to change anything, leave the two write scopes off; everything except `restore --apply` still works.

4. Back on **Overview**, click **Install app** in the **Installs** card and install it on your store.
5. Keep the **Overview** page open. The **Credentials** card shows the **Client ID** and **Client secret**, each with a copy button. You need both in the next step.

**Same organization required.** This kind of app login (Shopify's client credentials grant) only works when the app and the store belong to the same Shopify organization. A store you own, or a development store created from the Dev Dashboard's **Dev stores** page, qualifies. A development store created from inside the Shopify admin does not.

### Step 5: Give Fallback your credentials

Fallback reads its credentials from a file named `.env` inside a `.fallback` folder in your home folder. Create the folder and open the file in a text editor:

**macOS and Linux:**

```bash
mkdir -p ~/.fallback
nano ~/.fallback/.env
```

**Windows (PowerShell):**

```powershell
New-Item -ItemType Directory -Force "$HOME\.fallback"
notepad "$HOME\.fallback\.env"
```

Notepad asks whether to create the file; choose **Yes**.

Paste these three lines, replacing the values with your own store domain and the Client ID and Client secret from step 4:

```
SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com
SHOPIFY_CLIENT_ID=your_client_id
SHOPIFY_CLIENT_SECRET=your_client_secret
```

Use your store's `.myshopify.com` address, not a custom domain like `shop.example.com`. You can find it in the Shopify admin under **Settings → Domains**.

Save and close the file. In nano: press Ctrl+O, Enter, then Ctrl+X. In Notepad: File → Save, then close.

On macOS and Linux, make the file readable only by you, since it contains your app's secret:

```bash
chmod 600 ~/.fallback/.env
```

### Step 6: Take your first snapshot

```
$ fallback snapshot
Capturing snapshot of example-store.myshopify.com at 2026-10-12T14:30:22.000Z
Captured 3 products (4 variants), 1 collections, 0 metafields, 0 inventory levels.
Captured 0 metaobjects (0 definitions), 0 metafield definitions.
Snapshot ID: 2026-10-12T14-30-22Z
Snapshot directory: ~/.fallback/snapshots/example-store.myshopify.com/2026-10-12T14-30-22Z
Duration: 2.4s
```

Your numbers will differ. A large store takes longer; Fallback prints nothing while it works and reports when it's done. The snapshot is saved on your computer, and the **Snapshot ID** is how you refer to it later. You don't need to copy it down; `fallback list` shows every snapshot you've taken:

```
$ fallback list
example-store.myshopify.com
SNAPSHOT ID           CAPTURED      SCOPE      COUNTS                       SIZE
2026-10-12T14-30-22Z  19 hours ago  p,c,m,o,i  3p / 4v / 1c / 0m / 0i / 0o  5 KB
```

### Step 7: See what changed

Later, after an AI session, a bulk import, or anything else that edits your catalog, compare the store against the snapshot:

```
$ fallback diff 2026-10-12T14-30-22Z
Diffing example-store.myshopify.com against snapshot 2026-10-12T14-30-22Z
Products
  Created: 0
  Updated: 2
    ~ Everyday Carry Bag | Free Shipping | Best Seller (gid://shopify/Product/8100000000001)
        title: "Everyday Carry Bag" → "Everyday Carry Bag | Free Shipping | Best Seller"
        tags.length: 2 → 3
        tags.2: undefined → "sale"
    ~ Canvas Tote (gid://shopify/Product/8100000000002)
        variants[gid://shopify/ProductVariant/4510000000003].price.amount: "64.00" → "51.20"
  Deleted: 0
  3 ignored changes (use --show-ignored to view)

Collections
  No changes (1 in snapshot, 1 in current)

Metafields
  No changes (0 in snapshot, 0 in current)

InventoryLevels
  No changes (0 in snapshot, 0 in current)

Metaobjects
  No changes (0 in snapshot, 0 in current)

MetaobjectDefinitions
  No changes (0 in snapshot, 0 in current)

MetafieldDefinitions
  No changes (0 in snapshot, 0 in current)
```

Each change reads `field: value in the snapshot → value now`. Here a product title was rewritten, a `sale` tag was added, and one variant's price dropped from 64.00 to 51.20. `diff` only reads; it never changes your store.

### Step 8: Put things back

`restore` without `--apply` is a preview. It shows what it would write and changes nothing:

```
$ fallback restore 2026-10-12T14-30-22Z
Planning restore of example-store.myshopify.com to snapshot 2026-10-12T14-30-22Z
Dry run — no changes written. Re-run with --apply to write.

To write: 2
  ~ gid://shopify/Product/8100000000001 (products)
      title: "Everyday Carry Bag | Free Shipping | Best Seller" → "Everyday Carry Bag"
      tags.length: 3 → 2
      tags.2: "sale" → undefined
  ~ gid://shopify/Product/8100000000002 (products)
      variants[gid://shopify/ProductVariant/4510000000003].price.amount: "51.20" → "64.00"
Skipped (created): 0
Skipped (deleted): 0
Skipped (unsupported): 0
```

Here each line reads `value now → value restore will write`. Read the preview, and when it's what you want, run the same command with `--apply`:

```
$ fallback restore 2026-10-12T14-30-22Z --apply
Restoring example-store.myshopify.com to snapshot 2026-10-12T14-30-22Z
Restored 2, failed 0, skipped 0
```

`--apply` writes immediately; there is no "are you sure" prompt. Restore puts back every field listed in the preview. To keep some of the changes, fix those individual records in the Shopify admin instead.

### A typical session

```bash
fallback snapshot                          # 1. before: note the Snapshot ID
# ...run the AI agent, bulk edit, or import...
fallback diff 2026-10-12T14-30-22Z         # 2. after: review what changed
fallback restore 2026-10-12T14-30-22Z      # 3. if needed: preview the rollback
fallback restore 2026-10-12T14-30-22Z --apply
```

Snapshots are cheap. Take one before anything you might want to undo.

### If something goes wrong

**`command not found: fallback`** (or `'fallback' is not recognized` on Windows)
Close the terminal and open a new one; a terminal only sees programs installed before it opened. If it persists, run `npm install -g @strlngco/fallback` again and read its output for errors.

**`running scripts is disabled on this system`** (Windows PowerShell)
PowerShell's default policy blocks the small launcher script npm installs for `fallback`. Allow locally installed scripts for your user account, then try again:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Alternatively, run Fallback from Command Prompt (`cmd`) instead of PowerShell; it isn't affected.

**`EACCES: permission denied` during `npm install -g`** (macOS and Linux)
Your Node installation puts global packages in a system folder you can't write to. Don't use `sudo`. Follow npm's guide, [Resolving EACCES permissions errors](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally), then install again.

**`Missing required environment variables: SHOPIFY_SHOP_DOMAIN, ...`**
Fallback can't find your credentials. Check that the file is at `~/.fallback/.env` (on Windows, `C:\Users\<you>\.fallback\.env`) and that each line has the exact name shown in step 5. On Windows, make sure Notepad didn't save it as `.env.txt`: run `dir "$HOME\.fallback"` and rename the file if needed.

**`Shop domain must be a myshopify.com domain ...`**
`SHOPIFY_SHOP_DOMAIN` must be your store's `.myshopify.com` address, with no `https://` and no trailing `/`. For example: `your-store.myshopify.com`.

**`Shopify rejected the client credentials exchange (HTTP 4xx)`**
Shopify didn't accept the Client ID and secret. Check that both are copied exactly, with no spaces or quotes around them, that the app is installed on this store, and that the app and the store are in the same organization (see step 4).

**`... requires the read_metaobjects and read_metaobject_definitions access scopes ...`**
The app is missing a scope. In the Dev Dashboard, click **New version** on the app's **Overview** page, add the scope to **Scopes**, click **Release**, and approve the update on your store. Or leave metaobjects out of the run with `--scope products,collections,metafields,inventory-levels`.

**`Could not reach your-store.myshopify.com` or `Request to Shopify timed out`**
A network problem between you and Shopify. Check your connection and run the command again.

Every command explains itself with `--help`, for example `fallback restore --help`.

---

## How it works

Four commands, four jobs.

`snapshot` reads your store via the Admin GraphQL API and writes one NDJSON file per resource type (products with variants, collections with members, metafields on every captured owner, metaobjects and their definitions, inventory levels) plus a `manifest.json` recording what was captured, when, and against which API version.

`list` walks `~/.fallback/snapshots/` and shows you what's there. Broken snapshots (directories whose `manifest.json` is missing or malformed) appear with their reason rather than getting hidden.

`diff` compares a snapshot to the current state of the store. Field-level changes come back as a flat list of `path: before → after`. Arrays of identifiable resources (variants, collection members) are diffed by stable identity, not array position, so reorders don't produce false-positive content changes. The snapshot side is read line by line; the comparison holds the snapshot's records for one resource type in memory at a time.

`restore` re-applies a snapshot to records that have drifted. It recomputes the diff, then writes only the fields that changed; nothing is touched if a record is already in sync. Dry-run by default; `--apply` performs the writes.

Everything is local. No cloud sync, no telemetry, no remote storage. Snapshots live on your disk. The only network traffic is to your own Shopify Admin API.

## Command reference

### `fallback snapshot`

Captures the current state of your store.

```
Options:
  --shop <domain>       Override SHOPIFY_SHOP_DOMAIN
  --scope <list>        Comma-separated subset: products, collections,
                        metafields, inventory-levels, metaobjects. Defaults
                        to all.
  --base-dir <path>     Override default ~/.fallback/snapshots/
  --json                Emit summary as JSON to stdout
  --quiet               Suppress all non-error output
```

Resources captured: products (with variants, prices, inventory quantity, options), collections (custom and smart, with resolved membership), metafields on product, variant, collection, and shop owners plus their definitions, metaobjects and their definitions, and inventory levels per location, including deactivated locations and fulfillment services' legacy locations. Metaobjects are part of the default scope; leave them out (`--scope products,collections,metafields,inventory-levels`) if you don't want to grant the two metaobject read scopes.

The manifest records which metafield owners were captured, so a later `diff` knows exactly what a given snapshot covers rather than assuming full coverage.

Variant prices reflect the shop's primary currency. Per-market overrides carried on `PriceList` resources are not captured.

If a capture fails or is interrupted with Ctrl-C, its partial snapshot directory is removed.

### `fallback list`

Shows snapshots on disk.

```
Options:
  --shop <domain>       Filter to a single shop
  --base-dir <path>     Override default ~/.fallback/snapshots/
  --json                Emit results as JSON to stdout
  --limit <n>           Show only the most recent N per shop
```

The `SCOPE` column abbreviates what each snapshot captured: `p` products, `c` collections, `m` metafields, `o` metaobjects, `i` inventory levels. `COUNTS` uses the same letters, plus `v` for variants.

Broken snapshots are surfaced, not hidden. A snapshot directory missing its `manifest.json` shows up with `(broken: manifest.json missing)` so you can decide whether to delete it.

### `fallback diff <snapshot-id>`

Compares a snapshot to current state.

```
Options:
  --shop <domain>       Override SHOPIFY_SHOP_DOMAIN
  --scope <list>        Limit comparison to specific resources
  --base-dir <path>     Override default ~/.fallback/snapshots/
  --json                Emit full diff as JSON to stdout
  --with-report         With --json, also render the human report to stderr
                        from the same diff (no second fetch)
  --summary-only        Compact per-resource counts only
  --show-ignored        Include suppressed fields (timestamps, positions)
```

Default output suppresses changes that happen on every save without meaningfully changing the store: `updatedAt` timestamps, variant `position` integers, option-value reorders, and variant inventory quantities (which move with every sale; track them through the `inventory-levels` resource instead). The count of suppressed changes appears under each resource section so silence is never misleading.

`--show-ignored` lifts the suppression and removes the three-change inline cap that keeps default output scannable. The audit view:

```
$ fallback diff 2026-10-12T14-30-22Z --show-ignored
Diffing example-store.myshopify.com against snapshot 2026-10-12T14-30-22Z
Products
  Created: 0
  Updated: 2
    ~ Everyday Carry Bag | Free Shipping | Best Seller (gid://shopify/Product/8100000000001)
        title: "Everyday Carry Bag" → "Everyday Carry Bag | Free Shipping | Best Seller"
        tags.length: 2 → 3
        tags.2: undefined → "sale"
        updatedAt: "2026-09-01T10:00:00Z" → "2026-10-13T09:02:44Z"
    ~ Canvas Tote (gid://shopify/Product/8100000000002)
        updatedAt: "2026-09-01T10:00:00Z" → "2026-10-13T09:02:51Z"
        variants[gid://shopify/ProductVariant/4510000000003].price.amount: "64.00" → "51.20"
        variants[gid://shopify/ProductVariant/4510000000003].updatedAt: "2026-09-01T10:00:00Z" → "2026-10-13T09:02:51Z"
  Deleted: 0
...
```

`--summary-only` prints one line per resource:

```
$ fallback diff 2026-10-12T14-30-22Z --summary-only
Diffing example-store.myshopify.com against snapshot 2026-10-12T14-30-22Z
Products: +0 / ~2 / -0 (3 in snapshot, 3 in current)
Collections: +0 / ~0 / -0 (1 in snapshot, 1 in current)
Metafields: +0 / ~0 / -0 (0 in snapshot, 0 in current)
InventoryLevels: +0 / ~0 / -0 (0 in snapshot, 0 in current)
Metaobjects: +0 / ~0 / -0 (0 in snapshot, 0 in current)
MetaobjectDefinitions: +0 / ~0 / -0 (0 in snapshot, 0 in current)
MetafieldDefinitions: +0 / ~0 / -0 (0 in snapshot, 0 in current)
```

JSON output validates against an internal schema before emission, so programmatic consumers (CI scripts, Claude Code skills, integration tooling) can rely on its shape. `--with-report` is used by the monitor to capture the human-readable report and the JSON from a single fetch.

Coverage is read from each snapshot's manifest, so a diff against a snapshot taken before some content type existed compares exactly what that snapshot captured.

### `fallback restore <snapshot-id>`

Bulk gap-protection for widespread drift. Re-applies a snapshot's values to products, variants, metafield values on any captured owner (product, variant, collection, shop), and metaobject field values that have drifted since the snapshot was taken, without touching records that are already in sync. Use it after an AI agent, a bulk CSV import, or any operation that made widespread changes. Single-record fixes are faster done directly in the admin; restore is for the broad case.

```
Options:
  --shop <domain>       Override SHOPIFY_SHOP_DOMAIN
  --scope <list>        Limit restore to: products, metafields, metaobjects.
                        Defaults to all resources captured in the snapshot.
  --apply               Perform the writes. Default is dry-run (prints the plan,
                        writes nothing).
  --base-dir <path>     Override default ~/.fallback/snapshots/
  --json                Emit the plan or result as JSON to stdout
  --summary-only        Print counts only (no per-record detail)
```

The plan shows each change as `current value → snapshot value`, the direction restore writes. There is no interactive confirmation; `--apply` writes immediately. Restore computes its plan from a fresh read of the store, so an edit someone makes between that read and the write is overwritten.

**Covered fields.** Product-level: title, description, product type, vendor, tags, status, SEO title and description, template suffix, handle. Variant-level: price, compare-at price, barcode, taxable flag, tax code, inventory policy, SKU, weight. Metafields: value and type, on every captured owner (product, variant, collection, and shop). Metaobjects: field values on captured entries.

**Not restored.** Inventory levels, collections, and product options are out of scope. Restore only re-applies drift to records that still exist: it does not recreate records deleted after the snapshot, and it does not delete records created after the snapshot. Metafield and metaobject *definitions* are diffed for visibility but never written back. Values in Shopify-managed namespaces or types (`shopify`, `shopify--*`) and app-reserved namespaces (`app--*`) are skipped. Metafields in other namespaces, including ones a third-party app writes to without the `app--` prefix, are restored like any other metafield; check the preview if an app manages data you don't want reverted.

**Partial failures.** If Shopify rejects a write, restore reports which record failed and why, continues with the rest, and exits `2`. A metafield Shopify rejects does not block the others sent with it. If a product was only partly written before its failure, the report says which parts were written. The exception is rejected credentials: every remaining write would fail the same way, so restore stops there and reports how many operations it did not attempt. Running the same restore again is safe: it recomputes the diff, so records already restored drop out of the plan.

**Access scope.** `restore --apply` requires `write_products` (which covers products, variants, and metafield values on every owner type), plus `write_metaobjects` when metaobjects are in scope. A dry run needs only the read scopes, including the metaobject read scopes when the snapshot captured metaobjects (without them Shopify returns empty results, and a dry run would misreport entries as deleted). A missing write scope fails `--apply` before anything is fetched or written.

Exit codes: `0` on a dry run, or when `--apply` completes with no write failures. `1` on user error: bad arguments, snapshot not found, `--scope` naming a resource not captured or not supported by restore, or a missing scope. `2` if any write fails.

## Configuration

### Credentials and environment variables

| Variable                | Required | Meaning                                                                                       |
| ----------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `SHOPIFY_SHOP_DOMAIN`   | yes      | Your store's `.myshopify.com` domain. `--shop` overrides it per command.                      |
| `SHOPIFY_CLIENT_ID`     | yes      | The Dev Dashboard app's Client ID.                                                            |
| `SHOPIFY_CLIENT_SECRET` | yes      | The Dev Dashboard app's Client secret.                                                        |
| `SHOPIFY_API_VERSION`   | no       | Admin API version, such as `2026-04` (the default). Recorded in each snapshot's manifest.     |

Fallback looks for each variable in this order and uses the first it finds:

1. The environment of the shell running the command.
2. A `.env` file in the current folder.
3. `~/.fallback/.env`.

The current-folder `.env` lets a project carry its own store settings, but it also means **the folder you run a command from can change which store it targets**. A project `.env` that sets `SHOPIFY_SHOP_DOMAIN` points `restore --apply` at that store. `diff` and `restore` name the store they are about to read or write on their first line, so check it before letting a restore run. When in doubt, pass `--shop your-store.myshopify.com` to name the store explicitly; it overrides every other setting.

Fallback exchanges the client credentials for a short-lived access token at runtime, kept in memory and refreshed automatically. The token never touches disk; your client credentials do, which is why step 5 recommends `chmod 600`.

### Where snapshots live

Snapshots are stored under `~/.fallback/snapshots/<shop-domain>/<snapshot-id>/`. Pass `--base-dir` to any command to use a different location. Each snapshot is a folder of plain JSON files; copy, archive, or delete them like any other files.

### Output and exit codes

Human-readable output goes to stderr. Structured data goes to stdout. You can pipe `--json` output to `jq` without the summary messages interfering. With `--json`, errors are written to stderr as `{"error": "...", "exitCode": n}` and stdout stays empty.

Exit codes are stable across commands:

- `0`: success (a diff with changes is still success; the command did its job)
- `1`: user error (missing credentials, invalid argument or scope, snapshot not found, missing access scope)
- `2`: operational error (Shopify API failure, network error or timeout, malformed snapshot, disk error)

A `diff` exits `0` whether or not it found changes. CI scripts that want to fail on drift should inspect the `--json` output (for example, checking whether any resource's `updated`, `created`, or `deleted` arrays are non-empty).

---

## The monitor

The monitor is optional. Skip this section entirely if you only want the tool.

On a multi-user storefront, catalog changes happen every day (a merchandiser edits a description, an app updates inventory, an agent runs a bulk price change), and Shopify keeps no ledger of it. The monitor turns Fallback into that ledger: a small worker that snapshots and diffs on a schedule and files a daily report of what moved, with `fallback restore` as the rollback when a change turns out to be one that should not have happened. Most drift is intended; the report's job is visibility, not anomaly detection.

Each run compares the store to the most recent snapshot on disk (a rolling baseline), then takes a fresh snapshot so the next run has something current to diff against. It reports by opening a GitHub issue **on the store's theme repo** (not the Fallback repo), because the people who care about a given store already watch its theme repo, and GitHub's own issue notifications become the email channel with no extra setup. A quiet day files nothing. Issues contain catalog data from the diff, so if the theme repo is public, so is the report.

### What adding the monitor takes

Standing up the monitor is more involved than installing the tool, because it needs its own read-only credentials, a place to run unattended, and permission to file issues on your theme repo. The full runbook is [`docs/scheduled-sentinel.md`](docs/scheduled-sentinel.md); the shape of it:

1. **A read-only Shopify app** (`Fallback-Sentinel`) on the same store, with read scopes only:

   ```
   read_products, read_inventory, read_locations,
   read_metaobjects, read_metaobject_definitions
   ```

   No write scopes: the always-on runner is physically unable to change the store.

2. **A Render Background Worker** (not a cron job; the worker needs a persistent disk for its rolling baseline, and Render disks don't attach to cron jobs). It builds `strlngco/fallback` and runs `node scripts/sentinel-loop.mjs`, which owns the daily schedule.

3. **A fine-grained GitHub PAT** scoped to the theme repo only, with **Issues: Read and write** and nothing else. A fine-grained token has a mandatory expiry, so calendar the renewal; when it lapses, reporting fails quietly (a logged failure at the report stage, not a crash), which is easy to miss.

4. **Environment on the worker**, the read-only app's `SHOPIFY_*` credentials plus:

   ```
   FALLBACK_BASE_DIR=/var/data/snapshots
   SENTINEL_REPORT_REPO=<owner>/<theme-repo>
   SENTINEL_GITHUB_TOKEN=<the fine-grained PAT>
   # optional:
   SENTINEL_RUN_HOUR_UTC=9          # UTC hour the daily run fires (default 9)
   SENTINEL_SCOPE=products,collections,metafields,metaobjects
   ```

Reports are per store: one store is one worker pointing at one theme repo. A second store is a second worker with its own read-only app and its own theme repo.

The monitor's exit codes have their own meaning: `0` on a quiet day, `1` when drift was found and reported, `2` when the run itself failed. (For the tool, `1` means a user error.) Drift information is never swallowed by a later failure, and an unreachable report channel is never silent. See the runbook for the reporting semantics, the rollback procedure from a sentinel snapshot, and operational detail.

---

## What Fallback doesn't do

- **Not a full-catalog rollback.** `restore` re-applies drifted field values to records that still exist. It does not recreate records deleted after the snapshot, remove records created after the snapshot, restore inventory levels, or restore collections. For those cases, use Shopify's own tooling or a dedicated backup app.
- **Not a theme tool.** Theme files have Shopify's own rollback; Fallback is for catalog data.
- **Not catastrophic backup.** Snapshots are pre-deploy safety nets, not insurance against malicious deletion or account compromise. Use a real backup app for that.
- **Not customer or order data.** Fallback is scoped to catalog. Customer and order data carry privacy and storage concerns that are out of scope.
- **Not a service.** There's no Strlng server. Snapshots live on your disk. The only network traffic is your store's Admin API, and, if you run the monitor, its report to your own GitHub repo.
- **Not an App Store app.** Fallback runs from your terminal or your CI pipeline. It's not in the App Store and doesn't appear in your admin; it authenticates through an app you create in the Dev Dashboard.

## Architecture

Three packages in a monorepo, plus a thin scheduler layer for the monitor.

- `@strlngco/fallback-core`: platform-agnostic. Snapshot and diff primitives as pure functions. Knows nothing about Shopify, the filesystem, or terminals.
- `@strlngco/fallback-shopify`: Shopify adapter. GraphQL queries, schema validation, the fetchers that yield typed records.
- `@strlngco/fallback`: the user-facing CLI. The only package that touches disk, environment variables, or stdout. The published package bundles the other two.
- `scripts/sentinel*.mjs`: the monitor. Zero-dependency Node scripts that run the built CLI on a schedule and file reports. Nothing in `packages/` knows the monitor exists.

The codebase is TypeScript, strict mode, ESM only, Node 20+. Runtime dependencies are minimal: `zod` for schema validation, `clipanion` for CLI parsing, `graphql-request` for the API client, `picocolors` for terminal color.

## Development

Working on Fallback itself needs [pnpm](https://pnpm.io) as well as Node 20+.

```bash
git clone https://github.com/strlngco/fallback.git
cd fallback
pnpm install
pnpm build
node packages/cli/dist/index.js --help     # run the CLI you just built
```

To put your build on your PATH as `fallback`, run `pnpm setup` once (then open a new terminal), and `pnpm link --global` from inside `packages/cli`.

The unit suite (`pnpm test`) runs without any Shopify credentials; all API calls are mocked. `node scripts/smoke-pack.mjs` packs the CLI and installs it the way npm users get it, outside the workspace.

A separate read-only integration suite runs against a real development store to catch contract drift the unit suite can't see: API version changes, response shape evolution, auth flow regressions. Configure the same three `SHOPIFY_*` variables the CLI uses, then:

```bash
pnpm test:integration
```

The integration tests assert structural properties (manifest validates, NDJSON lines parse, diff is empty against a fresh self-snapshot) rather than specific counts, so they work against stores of any size. Their snapshots live under the system temp directory and are cleaned up after each run; your real `~/.fallback/snapshots/` is never touched, and the tests do not modify the store. They run manually before each release, not in CI.

## A note on the name

Fallback is the operation, not the brand. When an AI agent breaks something in your store, fallback is what you reach for. The name is a verb pretending to be a noun.

## Studio

Fallback is the first tool from [Strlng](https://strlng.co), a small studio building deterministic infrastructure for AI-augmented e-commerce workflows.

## License

MIT. See [LICENSE](./LICENSE).

## Support

This is open source, maintained on the schedule of one person with a demanding day job. Issues are read and triaged but not on a contractual timeline. Pull requests are welcome with no promised review SLA.

If something is broken, [file an issue](https://github.com/strlngco/fallback/issues) with a reproducible test case. If you've built something interesting on top, mention it; Strlng's tools are designed to compose.
