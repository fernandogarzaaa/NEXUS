// Legacy migration harness, DRY RUN ONLY. Reads the source through the
// read-only adapter layer, maps to canonical types, and reports. Writes
// nothing to the source and nothing to the NEXUS store.
// Usage: npm run migrate:dry-run -- --mapping adapters/generic/mapping.json [--entity shipment] [--out report.json] [--snapshot-dir ./snapshots]
import fs from "node:fs";
import { loadState } from "../lib/domain/store";
import type { CanonicalEntity } from "../lib/domain/schemas";
import { dryRunFromMappingFile, summarizeDryRun } from "../lib/migration/harness";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const mappingPath = arg("--mapping");
  if (!mappingPath) throw new Error("--mapping <path to mapping.json> is required");
  const entity = arg("--entity") as CanonicalEntity | undefined;
  const state = await loadState(); // read only; honours NEXUS_STATE_BACKEND
  const report = await dryRunFromMappingFile(mappingPath, state, {
    entities: entity ? [entity] : undefined,
    snapshotDir: arg("--snapshot-dir"),
  });
  console.log(summarizeDryRun(report));
  const out = arg("--out");
  if (out) {
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(`\nFull report written to ${out}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
