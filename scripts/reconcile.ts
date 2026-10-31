// Read-only reconciliation of an external source against the canonical store.
// Usage: npm run reconcile -- --mapping adapters/generic/mapping.json [--entity shipment] [--out report.json]
import fs from "node:fs";
import { loadState } from "../lib/domain/store";
import { runReconciliation, summarizeReconciliation } from "../lib/adapters";
import type { CanonicalEntity } from "../lib/domain/schemas";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const mappingPath = arg("--mapping");
  if (!mappingPath) throw new Error("--mapping <path to mapping.json> is required");
  const entity = arg("--entity") as CanonicalEntity | undefined;
  const state = await loadState(); // honours NEXUS_STATE_BACKEND; read only
  const report = await runReconciliation(mappingPath, state, entity ? { entities: [entity] } : {});
  console.log(summarizeReconciliation(report));
  const out = arg("--out");
  if (out) {
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(`\nFull report written to ${out}`);
  } else {
    console.log("\nPass --out <file> to write the full JSON report.");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
