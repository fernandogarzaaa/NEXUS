# Legacy migration harness (dry run only)

`lib/migration/harness.ts` answers "what would happen if we migrated this
source into NEXUS" without doing it. It is the second consumer of the
adapter seam (`lib/adapters/`); the first is the reconciliation report.

## Guarantees

- **The source is never written.** The only access path is
  `SourceAdapter.fetch()`; no adapter has a write method.
- **NEXUS is never written.** The harness reads the current working set to
  classify rows; the report's `sourceWritesAttempted` and
  `storeWritesAttempted` are literally `0`.
- **Duplicates are never merged.** Every row in a duplicate group (same
  source id, or different rows mapping to the same canonical id) is
  quarantined and reported with whether the group is identical or
  conflicting. A human decides which row survives.
- **There is no non-dry-run flag.** A real import will be a separate,
  approval-gated step built on this report, not a switch on this script.

## What it does

1. Snapshot, in dependency order (facility → vehicle → driver → shipment),
   recording row count, a SHA-256 of the raw rows, and optionally a local
   copy (`--snapshot-dir`).
2. Map each row with the mapping file (`adapters/<system>/mapping.json`)
   and validate against the canonical Zod schemas
   (`lib/domain/schemas.ts`).
3. Quarantine rows that fail mapping or validation (with the exact
   missing fields and errors), and every member of a duplicate group.
4. Check references on accepted rows (driver, vehicle, facility ids)
   against the ids accepted earlier in the same run or already held by
   NEXUS. Dangling references are **warnings**, because the referenced
   entity may live in another of Senor's systems (open question).
5. Classify accepted rows against the current store: would create, would
   update (field-level differences, honouring the mapping's
   `reconcile.ignoreFields`), unchanged.

## Report shape

`MigrationDryRunReport` → `entities[]` → `{ snapshot, counts, missingFields,
duplicates, danglingReferences, quarantined, wouldCreate, wouldUpdate,
unchanged }`. `npm run migrate:dry-run -- --out report.json` writes the
JSON; the console shows a per-entity summary with every quarantined row.

## Open questions this report is meant to inform

- Which Senor system owns shipment, order, customer and invoice — the
  dangling-reference list shows which ids a given export cannot resolve.
- Whether the legacy database can be read directly (a REST/CSV adapter
  today; a read-only SQL adapter would implement the same `SourceAdapter`).
- Who resolves duplicates and what audit retention the resolution needs.
