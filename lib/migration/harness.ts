import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { CanonicalEntity } from "../domain/schemas";
import type { NexusState } from "../domain/state";
import { createAdapters, loadMappingFile, mapRow, mappedEntities, type MappedRow, type MappingFile, type SourceAdapter, type SourceRecord } from "../adapters";

// ---------------------------------------------------------------------------
// Legacy migration harness — DRY RUN ONLY.
//
// Takes a read-only snapshot of the source through the adapter layer, maps
// every row to the canonical Shipment / Driver / Vehicle / Facility types,
// and reports what a real migration would do: counts, duplicates, missing
// fields, dangling references, quarantined rows, and which accepted rows
// would be created / updated / left unchanged in NEXUS.
//
// Guarantees, by construction:
//   - the source is never written (adapters expose fetch() only);
//   - the NEXUS store is never written (this module only reads `state`);
//   - duplicates are never merged: every row in a duplicate group is
//     quarantined and reported for a human to resolve.
// ---------------------------------------------------------------------------

export interface SnapshotInfo {
  fetchedAt: string;
  rows: number;
  sha256: string;
  /** Where the snapshot copy was written, when a snapshot dir was given. */
  file: string | null;
}

export interface QuarantineEntry {
  sourceId: string;
  canonicalId: string | null;
  locator: string;
  reasons: string[];
  missingFields: string[];
}

export interface FieldDifference {
  field: string;
  source: unknown;
  canonical: unknown;
}

export interface EntityDryRun {
  entity: CanonicalEntity;
  snapshot: SnapshotInfo;
  counts: {
    sourceRows: number;
    accepted: number;
    quarantined: number;
    wouldCreate: number;
    wouldUpdate: number;
    unchanged: number;
  };
  /** Canonical fields the source could not supply, with how many rows lacked each. */
  missingFields: Array<{ field: string; rows: number }>;
  duplicates: {
    bySourceId: Array<{ sourceId: string; count: number; identical: boolean; locators: string[] }>;
    byCanonicalId: Array<{ canonicalId: string; sourceIds: string[]; identical: boolean; locators: string[] }>;
  };
  /** Accepted rows whose references point at ids absent from this snapshot. Warnings, not quarantine. */
  danglingReferences: Array<{ canonicalId: string; field: string; value: string; locator: string }>;
  quarantined: QuarantineEntry[];
  wouldCreate: Array<{ canonicalId: string; sourceId: string; locator: string }>;
  wouldUpdate: Array<{ canonicalId: string; sourceId: string; locator: string; differences: FieldDifference[] }>;
  unchanged: string[];
}

export interface MigrationDryRunReport {
  mode: "DRY_RUN";
  generatedAt: string;
  mapping: { name: string; system: string };
  /** Always zero; present so a reader of the JSON sees the guarantee explicitly. */
  sourceWritesAttempted: 0;
  storeWritesAttempted: 0;
  entities: EntityDryRun[];
}

const STORE_KEY: Record<CanonicalEntity, "shipments" | "drivers" | "vehicles" | "facilities"> = {
  shipment: "shipments",
  driver: "drivers",
  vehicle: "vehicles",
  facility: "facilities",
};

/** Which canonical fields reference which entity, for the dangling-reference check. */
const REFERENCES: Record<CanonicalEntity, Array<{ field: string; entity: CanonicalEntity }>> = {
  shipment: [
    { field: "driverId", entity: "driver" },
    { field: "vehicleId", entity: "vehicle" },
    { field: "originFacilityId", entity: "facility" },
    { field: "destinationFacilityId", entity: "facility" },
    { field: "appointment.facilityId", entity: "facility" },
  ],
  driver: [
    { field: "homeFacilityId", entity: "facility" },
    { field: "vehicleId", entity: "vehicle" },
  ],
  vehicle: [{ field: "currentDriverId", entity: "driver" }],
  facility: [],
};

function stable(value: unknown): string {
  return JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort()) : v
  );
}

function getAt(record: Record<string, unknown>, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((cur, k) => (cur && typeof cur === "object" ? (cur as Record<string, unknown>)[k] : undefined), record);
}

export interface DryRunOptions {
  entities?: CanonicalEntity[];
  /** Directory to write a copy of each snapshot into (local file; never the source). */
  snapshotDir?: string;
}

/**
 * Dry-run one entity: `rows` is the read-only snapshot, `state` the current
 * canonical working set (read only). Pure apart from the optional snapshot file.
 */
export function dryRunEntity(
  entity: CanonicalEntity,
  mapping: MappingFile,
  rows: SourceRecord[],
  state: NexusState,
  snapshotFile: string | null,
  acceptedIdsByEntity: Partial<Record<CanonicalEntity, Set<string>>>
): EntityDryRun {
  const em = mapping.entities[entity];
  if (!em) throw new Error(`Mapping "${mapping.name}" has no entry for entity "${entity}"`);
  const canonical = state[STORE_KEY[entity]] as unknown as Map<string, Record<string, unknown>>;

  const results = rows.map((r) => mapRow(entity, em, r.raw, r.locator));
  const quarantine = new Map<string, QuarantineEntry>(); // keyed by locator
  const q = (r: { sourceId: string; canonicalId: string | null; locator: string }, reason: string, missing: string[] = []) => {
    const entry = quarantine.get(r.locator) ?? { sourceId: r.sourceId, canonicalId: r.canonicalId, locator: r.locator, reasons: [], missingFields: [] };
    entry.reasons.push(reason);
    for (const m of missing) if (!entry.missingFields.includes(m)) entry.missingFields.push(m);
    quarantine.set(r.locator, entry);
  };

  const missingCounts = new Map<string, number>();
  for (const r of results) {
    if (r.ok) continue;
    for (const m of r.missingFields) missingCounts.set(m, (missingCounts.get(m) ?? 0) + 1);
    const reasons = [...r.errors, ...(r.missingFields.length ? [`missing required fields: ${r.missingFields.join(", ")}`] : [])];
    q(r, reasons.length ? reasons.join("; ") : "did not map to a valid canonical record", r.missingFields);
  }

  // Duplicate detection runs over every row (mapped or not) for source ids,
  // and over mapped rows for canonical ids. Nothing is merged: all members
  // of a group are quarantined so a human decides which survives.
  const bySource = new Map<string, Array<{ row: SourceRecord; result: (typeof results)[number] }>>();
  rows.forEach((row, i) => {
    if (!row.sourceId) return;
    bySource.set(row.sourceId, [...(bySource.get(row.sourceId) ?? []), { row, result: results[i] }]);
  });
  const dupBySource = Array.from(bySource.entries())
    .filter(([, g]) => g.length > 1)
    .map(([sourceId, g]) => {
      const identical = new Set(g.map(({ row }) => stable(row.raw))).size === 1;
      for (const { result } of g) q(result, `duplicate source id "${sourceId}" (${g.length} rows, ${identical ? "identical" : "conflicting"}); not merged, manual resolution required`);
      return { sourceId, count: g.length, identical, locators: g.map(({ row }) => row.locator) };
    });

  const mapped = results.filter((r): r is MappedRow => r.ok);
  const byCanonical = new Map<string, MappedRow[]>();
  for (const r of mapped) byCanonical.set(r.canonicalId, [...(byCanonical.get(r.canonicalId) ?? []), r]);
  const dupByCanonical = Array.from(byCanonical.entries())
    .filter(([, g]) => g.length > 1)
    .map(([canonicalId, g]) => {
      const identical = new Set(g.map((r) => stable(r.record))).size === 1;
      for (const r of g) q(r, `maps to canonical id ${canonicalId} together with ${g.length - 1} other row(s) (${identical ? "identical" : "conflicting"}); not merged`);
      return { canonicalId, sourceIds: g.map((r) => r.sourceId), identical, locators: g.map((r) => r.locator) };
    });

  const accepted = mapped.filter((r) => !quarantine.has(r.locator));
  const acceptedIds = new Set(accepted.map((r) => r.canonicalId));
  acceptedIdsByEntity[entity] = acceptedIds;

  // Dangling references: against ids this snapshot accepted (when that
  // entity is part of the run) or, failing that, ids NEXUS already holds.
  const danglingReferences: EntityDryRun["danglingReferences"] = [];
  for (const r of accepted) {
    for (const ref of REFERENCES[entity]) {
      const value = getAt(r.record, ref.field);
      if (typeof value !== "string" || value.length === 0) continue;
      const known = acceptedIdsByEntity[ref.entity];
      const canonicalKnown = (state[STORE_KEY[ref.entity]] as Map<string, unknown>).has(value);
      const ok = known ? known.has(value) || canonicalKnown : canonicalKnown;
      if (!ok) danglingReferences.push({ canonicalId: r.canonicalId, field: ref.field, value, locator: r.locator });
    }
  }

  const ignore = new Set(em.reconcile.ignoreFields);
  const wouldCreate: EntityDryRun["wouldCreate"] = [];
  const wouldUpdate: EntityDryRun["wouldUpdate"] = [];
  const unchanged: string[] = [];
  for (const r of accepted) {
    const existing = canonical.get(r.canonicalId);
    if (!existing) {
      wouldCreate.push({ canonicalId: r.canonicalId, sourceId: r.sourceId, locator: r.locator });
      continue;
    }
    const differences: FieldDifference[] = [];
    for (const field of Object.keys(r.record)) {
      if (ignore.has(field)) continue;
      if (stable(r.record[field]) !== stable(existing[field])) differences.push({ field, source: r.record[field], canonical: existing[field] });
    }
    if (differences.length) wouldUpdate.push({ canonicalId: r.canonicalId, sourceId: r.sourceId, locator: r.locator, differences });
    else unchanged.push(r.canonicalId);
  }

  const quarantined = Array.from(quarantine.values());
  return {
    entity,
    snapshot: {
      fetchedAt: new Date().toISOString(),
      rows: rows.length,
      sha256: createHash("sha256").update(stable(rows.map((r) => r.raw))).digest("hex"),
      file: snapshotFile,
    },
    counts: {
      sourceRows: rows.length,
      accepted: accepted.length,
      quarantined: quarantined.length,
      wouldCreate: wouldCreate.length,
      wouldUpdate: wouldUpdate.length,
      unchanged: unchanged.length,
    },
    missingFields: Array.from(missingCounts.entries())
      .map(([field, n]) => ({ field, rows: n }))
      .sort((a, b) => b.rows - a.rows || a.field.localeCompare(b.field)),
    duplicates: { bySourceId: dupBySource, byCanonicalId: dupByCanonical },
    danglingReferences,
    quarantined,
    wouldCreate,
    wouldUpdate,
    unchanged,
  };
}

/** Order entities so referenced ones are snapshotted first (facility -> vehicle -> driver -> shipment). */
const RUN_ORDER: CanonicalEntity[] = ["facility", "vehicle", "driver", "shipment"];

export async function dryRun(
  mapping: MappingFile,
  adapters: Partial<Record<CanonicalEntity, SourceAdapter>>,
  state: NexusState,
  opts: DryRunOptions = {}
): Promise<MigrationDryRunReport> {
  const wanted = new Set(opts.entities ?? mappedEntities(mapping));
  const acceptedIdsByEntity: Partial<Record<CanonicalEntity, Set<string>>> = {};
  const entities: EntityDryRun[] = [];
  if (opts.snapshotDir) fs.mkdirSync(opts.snapshotDir, { recursive: true });
  for (const entity of RUN_ORDER) {
    if (!wanted.has(entity)) continue;
    const adapter = adapters[entity];
    if (!adapter) throw new Error(`No adapter for entity "${entity}"`);
    const rows = await adapter.fetch(entity);
    let file: string | null = null;
    if (opts.snapshotDir) {
      file = path.join(opts.snapshotDir, `${entity}.snapshot.json`);
      fs.writeFileSync(file, JSON.stringify({ entity, adapter: adapter.name, fetchedAt: new Date().toISOString(), rows }, null, 2));
    }
    entities.push(dryRunEntity(entity, mapping, rows, state, file, acceptedIdsByEntity));
  }
  return {
    mode: "DRY_RUN",
    generatedAt: new Date().toISOString(),
    mapping: { name: mapping.name, system: mapping.system },
    sourceWritesAttempted: 0,
    storeWritesAttempted: 0,
    entities,
  };
}

export async function dryRunFromMappingFile(mappingPath: string, state: NexusState, opts: DryRunOptions = {}): Promise<MigrationDryRunReport> {
  const loaded = loadMappingFile(mappingPath);
  return dryRun(loaded.mapping, createAdapters(loaded), state, opts);
}

export function summarizeDryRun(report: MigrationDryRunReport): string {
  const lines = [
    `MIGRATION DRY RUN — ${report.mapping.name} — ${report.mapping.system}`,
    `generated ${report.generatedAt}; source writes: ${report.sourceWritesAttempted}; store writes: ${report.storeWritesAttempted}`,
    "",
  ];
  for (const e of report.entities) {
    const c = e.counts;
    lines.push(
      `${e.entity.padEnd(9)} snapshot ${String(c.sourceRows).padStart(4)} rows (sha256 ${e.snapshot.sha256.slice(0, 12)}…) | accepted ${String(c.accepted).padStart(4)} ` +
        `(create ${c.wouldCreate}, update ${c.wouldUpdate}, unchanged ${c.unchanged}) | quarantined ${String(c.quarantined).padStart(3)} | ` +
        `dup source ids ${e.duplicates.bySourceId.length} | dup canonical ids ${e.duplicates.byCanonicalId.length} | dangling refs ${e.danglingReferences.length}`
    );
    for (const m of e.missingFields) lines.push(`          missing ${m.field}: ${m.rows} row(s)`);
    for (const qd of e.quarantined) lines.push(`          quarantined ${qd.locator} (source id ${qd.sourceId || "<empty>"}): ${qd.reasons.join(" | ")}`);
    for (const d of e.danglingReferences) lines.push(`          dangling ${d.canonicalId}.${d.field} -> ${d.value} (${d.locator})`);
  }
  return lines.join("\n");
}
