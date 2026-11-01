---
name: fallback
description: Use when about to change data in a Shopify store through the Admin API, by GraphQL mutation, an MCP or app tool, a bulk operation, a CSV import or a script, and the `fallback` CLI is installed. Covers products, variants, prices, collections, metafields, metaobjects and inventory.
---

# Fallback around Shopify writes

Take a Fallback snapshot before writing to a Shopify store and diff against it
after, so the user sees exactly what changed and can undo it. Fallback only
reads from Shopify. This skill never writes with it.

## Before the first write

1. Name the store. Use the `.myshopify.com` domain your write will target and
   pass it as `--shop` on every `fallback` command. Fallback otherwise reads
   the store from the shell, a `.env` in the current folder, or
   `~/.fallback/.env`, which may point somewhere else.
2. Snapshot:

   ```bash
   fallback snapshot --shop <store>.myshopify.com --json
   ```

   Read `snapshotId` from the JSON on stdout (for example
   `2026-11-01T17-04-12Z`). One snapshot covers the whole session; take another
   only after a diff has been reported.
3. If the snapshot exits non-zero, do not write. Show the user the error
   (exit `1` is credentials, arguments or a missing read scope; `2` is
   Shopify, network or disk) and ask how to proceed.

Use only the flags shown here or in `fallback <command> --help`. There is no
label or name option; the id is the timestamp.

## After the writes

```bash
fallback diff <snapshotId> --shop <store>.myshopify.com
```

Exit `0` means the diff ran, not that nothing changed. Then tell the user:

- the store named on the diff's first line;
- the per-resource counts (created, updated, deleted);
- the changed fields that match what you meant to do, briefly;
- every change you did not intend, in full. The diff covers the whole store,
  so edits by people or apps since the snapshot appear too;
- the snapshot id, and how to undo (below).

For a large diff, run `--summary-only` first, then show the records you
touched. Use `--json` when you need to check values programmatically.

## Undo is the user's call

Never run `fallback restore <id> --apply`. It writes immediately with no
confirmation, and it overwrites anything edited since its own read.

If the user wants to undo, you may run the dry run, which only reads:

```bash
fallback restore <snapshotId> --shop <store>.myshopify.com
```

Show the plan (`current → snapshot`), then give the user the `--apply` command
to run themselves. Restore does not cover inventory levels, collections or
product options, and it does not recreate deleted records or delete created
ones; say so if the diff includes any of those.

If you reverse your own changes with ordinary writes, that is a new write: take
a fresh snapshot first, then diff against it and against the original snapshot,
and report both.

## Red flags

- "It's one small change, no need for a snapshot." Small writes are the ones
  nobody remembers. Snapshot.
- "The user said just do it." That covers the write, not skipping the record
  of it.
- "The snapshot failed, I'll write anyway and check by hand." Stop and ask.
- "The diff exited 0, so nothing unexpected happened." Read the report.
