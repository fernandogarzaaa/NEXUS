import type { CanonicalEntity } from "../domain/schemas";
import type { NexusState } from "../domain/state";
import { mapRow, type EntityMapping, type MappedRow, type MappingFile, type QuarantinedRow } from "./mapping";
import type { SourceAdapter, SourceRecord } from "./types";

// ---------------------------------------------------------------------------
// Reconciliation: compare one entity as the external source presents it
// (after mapping) against the canonical NEXUS working set. Reads only; the
// report is the output. Nothing here mutates the source or the store.
// ---------------------------------------------------------------------------

export interface MatchedRecord {
  sourceId: string;
  canonicalId: string;
  locator: string;
  /** Top-level canonical fields whose mapped value differs from the store. */
  differences: Array<{ field: string; source: unknown; canonical: unknown }>;
}

export interface UnmatchedRecord {
  sourceId: string;
  canonicalId: string;
  locator: string;
}

export interface EntityReconciliation {
  entity: CanonicalEntity;
  source: { adapter: string; rows: number; mapped: number; quarantined: number };
  canonical: { rows: number };
  matched: MatchedRecord[];
  /** Mapped cleanly but NEXUS has no record with that canonical id. */
  unmatched: UnmatchedRecord[];
  /** Canonical ids NEXUS holds that the source did not present. */
  missingInSource: string[];
  duplicates: {
    /** The same source id appeared more than once in the source. */
    bySourceId: Array<{ sourceId: string; count: number; locators: string[] }>;
    /** Different source rows mapped to the same canonical id. */
    byCanonicalId: Array<{ canonicalId: string; sourceIds: string[]; locators: string[] }>;
  };
  quarantined: QuarantinedRow[];
}

export interface ReconciliationReport {
  generatedAt: string;
  mapping: { name: string; system: string };
  entities: EntityReconciliation[];
}

const STORE_KEY: Record<CanonicalEntity, keyof Pick<NexusState, "shipments" | "drivers" | "vehicles" | "facilities">> = {
  shipment: "shipments",
  driver: "drivers",
  vehicle: "vehicles",
  facility: "facilities",
};

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function reconcileEntity(
  entity: CanonicalEntity,
  mapping: EntityMapping,
  adapterName: string,
  rows: SourceRecord[],
  state: NexusState
): EntityReconciliation {
  const canonical = state[STORE_KEY[entity]] as unknown as Map<string, Record<string, unknown>>;
  const results = rows.map((r) => mapRow(entity, mapping, r.raw, r.locator));
  const mapped = results.filter((r): r is MappedRow => r.ok);
  const quarantined = results.filter((r): r is QuarantinedRow => !r.ok);

  const bySource = new Map<string, SourceRecord[]>();
  for (const r of rows) {
    if (!r.sourceId) continue;
    bySource.set(r.sourceId, [...(bySource.get(r.sourceId) ?? []), r]);
  }
  const byCanonical = new Map<string, MappedRow[]>();
  for (const r of mapped) byCanonical.set(r.canonicalId, [...(byCanonical.get(r.canonicalId) ?? []), r]);

  const ignore = new Set(mapping.reconcile.ignoreFields);
  const matched: MatchedRecord[] = [];
  const unmatched: UnmatchedRecord[] = [];
  const seenCanonical = new Set<string>();
  for (const r of mapped) {
    const existing = canonical.get(r.canonicalId);
    if (!existing) {
      unmatched.push({ sourceId: r.sourceId, canonicalId: r.canonicalId, locator: r.locator });
      continue;
    }
    seenCanonical.add(r.canonicalId);
    const differences: MatchedRecord["differences"] = [];
    for (const field of Object.keys(r.record)) {
      if (ignore.has(field)) continue;
      if (!same(r.record[field], existing[field])) {
        differences.push({ field, source: r.record[field], canonical: existing[field] });
      }
    }
    matched.push({ sourceId: r.sourceId, canonicalId: r.canonicalId, locator: r.locator, differences });
  }

  return {
    entity,
    source: { adapter: adapterName, rows: rows.length, mapped: mapped.length, quarantined: quarantined.length },
    canonical: { rows: canonical.size },
    matched,
    unmatched,
    missingInSource: Array.from(canonical.keys()).filter((id) => !seenCanonical.has(id)),
    duplicates: {
      bySourceId: Array.from(bySource.entries())
        .filter(([, list]) => list.length > 1)
        .map(([sourceId, list]) => ({ sourceId, count: list.length, locators: list.map((l) => l.locator) })),
      byCanonicalId: Array.from(byCanonical.entries())
        .filter(([, list]) => list.length > 1)
        .map(([canonicalId, list]) => ({
          canonicalId,
          sourceIds: list.map((l) => l.sourceId),
          locators: list.map((l) => l.locator),
        })),
    },
    quarantined,
  };
}

export async function reconcile(
  mapping: MappingFile,
  adapters: Partial<Record<CanonicalEntity, SourceAdapter>>,
  state: NexusState,
  entities: CanonicalEntity[]
): Promise<ReconciliationReport> {
  const out: EntityReconciliation[] = [];
  for (const entity of entities) {
    const em = mapping.entities[entity];
    const adapter = adapters[entity];
    if (!em || !adapter) throw new Error(`No mapping/adapter for entity "${entity}"`);
    const rows = await adapter.fetch(entity);
    out.push(reconcileEntity(entity, em, adapter.name, rows, state));
  }
  return {
    generatedAt: new Date().toISOString(),
    mapping: { name: mapping.name, system: mapping.system },
    entities: out,
  };
}

export function summarizeReconciliation(report: ReconciliationReport): string {
  const lines = [`Reconciliation for ${report.mapping.name} — ${report.mapping.system}`, `generated ${report.generatedAt}`, ""];
  for (const e of report.entities) {
    const drift = e.matched.filter((m) => m.differences.length > 0).length;
    lines.push(
      `${e.entity.padEnd(9)} source rows ${String(e.source.rows).padStart(4)} | mapped ${String(e.source.mapped).padStart(4)} | quarantined ${String(e.source.quarantined).padStart(3)} | ` +
        `matched ${String(e.matched.length).padStart(4)} (${drift} with differences) | unmatched ${String(e.unmatched.length).padStart(3)} | ` +
        `missing in source ${String(e.missingInSource.length).padStart(4)} | dup source ids ${e.duplicates.bySourceId.length} | dup canonical ids ${e.duplicates.byCanonicalId.length}`
    );
  }
  return lines.join("\n");
}
