import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getState, resetState } from "@/lib/domain/store";
import { serializeState } from "@/lib/domain/state";
import { HERO_SHIPMENT_ID } from "@/lib/domain/seed";
import { parseMappingFile, type SourceAdapter, type SourceRecord } from "@/lib/adapters";
import { dryRun, dryRunFromMappingFile, summarizeDryRun } from "@/lib/migration/harness";

const GENERIC = path.join(process.cwd(), "adapters", "generic", "mapping.json");

describe("migration harness (dry run only)", () => {
  beforeEach(() => resetState());

  it("snapshots, maps and classifies the generic extract without touching the store", async () => {
    const before = serializeState(getState());
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-snap-"));
    const report = await dryRunFromMappingFile(GENERIC, getState(), { snapshotDir: dir });

    expect(report.mode).toBe("DRY_RUN");
    expect(report.sourceWritesAttempted).toBe(0);
    expect(report.storeWritesAttempted).toBe(0);
    expect(serializeState(getState())).toEqual(before); // nothing written to NEXUS
    expect(report.entities.map((e) => e.entity)).toEqual(["facility", "vehicle", "driver", "shipment"]);

    const s = report.entities.find((e) => e.entity === "shipment")!;
    expect(s.counts).toEqual({ sourceRows: 11, accepted: 6, quarantined: 5, wouldCreate: 1, wouldUpdate: 0, unchanged: 5 });
    expect(s.wouldCreate).toEqual([{ canonicalId: "SHP-9999", sourceId: "9999", locator: "shipments.csv:11" }]);
    expect(s.unchanged).toEqual(["SHP-1000", "SHP-1001", "SHP-1002", "SHP-1004", "SHP-1005"]);
    // Duplicates are reported and quarantined, never merged — including the
    // identical pair and the conflicting pair for the hero shipment.
    expect(s.duplicates.bySourceId).toEqual([
      { sourceId: "1003", count: 2, identical: true, locators: ["shipments.csv:5", "shipments.csv:9"] },
      { sourceId: "2000", count: 2, identical: false, locators: ["shipments.csv:8", "shipments.csv:10"] },
    ]);
    expect(s.duplicates.byCanonicalId.map((d) => [d.canonicalId, d.identical])).toEqual([["SHP-1003", true], [HERO_SHIPMENT_ID, false]]);
    expect(s.quarantined.map((q) => q.sourceId).sort()).toEqual(["1003", "1003", "1050", "2000", "2000"]);
    const bad = s.quarantined.find((q) => q.sourceId === "1050")!;
    expect(bad.missingFields).toContain("customerName");
    expect(bad.reasons.join(" ")).toMatch(/status: value "UNKNOWN"/);
    expect(s.missingFields).toEqual([{ field: "customerName", rows: 1 }]);
    expect(s.danglingReferences).toEqual([]);

    const d = report.entities.find((e) => e.entity === "driver")!;
    expect(d.counts).toMatchObject({ sourceRows: 11, accepted: 10, quarantined: 1, unchanged: 10, wouldCreate: 0 });
    expect(d.snapshot.file).toBe(path.join(dir, "driver.snapshot.json"));
    expect(JSON.parse(fs.readFileSync(d.snapshot.file!, "utf8")).rows).toHaveLength(11);
    expect(d.snapshot.sha256).toMatch(/^[0-9a-f]{64}$/);

    const summary = summarizeDryRun(report);
    expect(summary).toContain("source writes: 0; store writes: 0");
    expect(summary).toContain("quarantined shipments.csv:12 (source id 1050)");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("flags references to ids that are neither in the snapshot nor in NEXUS as warnings, not quarantine", async () => {
    const mapping = parseMappingFile({
      name: "stub",
      system: "stub system",
      readOnly: true,
      entities: {
        driver: {
          source: { type: "csv", path: "unused.csv" },
          sourceIdField: "code",
          fields: {
            id: { template: "D-{code}" }, name: { from: "name" }, homeFacilityId: { template: "FAC-{depot}" }, status: { const: "AVAILABLE" },
            location: { object: { lat: { from: "lat", transform: "number" }, lng: { from: "lng", transform: "number" } } },
            assignedShipmentIds: { const: [] }, hoursOfServiceRemaining: { const: 8 }, onTimeRating: { const: 0.9 }, vehicleId: { template: "VEH-{fleet}", nullIfEmpty: true },
          },
        },
      },
    });
    const rows: SourceRecord[] = [
      { entity: "driver", sourceId: "20", raw: { code: "20", name: "New Driver", depot: "DAL", lat: "32.7", lng: "-96.8", fleet: "99" }, locator: "stub:1" },
      { entity: "driver", sourceId: "21", raw: { code: "21", name: "Other Driver", depot: "PER", lat: "32.7", lng: "-96.8", fleet: "01" }, locator: "stub:2" },
    ];
    const stub: SourceAdapter = { name: "stub", kind: "csv", fetch: async () => rows };
    const report = await dryRun(mapping, { driver: stub }, getState());
    const d = report.entities[0];
    expect(d.counts).toMatchObject({ accepted: 2, quarantined: 0, wouldCreate: 2 });
    expect(d.danglingReferences).toEqual([
      { canonicalId: "D-20", field: "vehicleId", value: "VEH-99", locator: "stub:1" },
      { canonicalId: "D-21", field: "homeFacilityId", value: "FAC-PER", locator: "stub:2" },
    ]);
  });

  it("reports would-update differences field by field for records NEXUS already holds", async () => {
    const stub: SourceAdapter = {
      name: "stub",
      kind: "csv",
      fetch: async () => [
        {
          entity: "vehicle",
          sourceId: "01",
          raw: { Fleet: "01", BodyType: "REEFER", PayloadKg: "1000", Status: "MAINTENANCE", DriverCode: "" },
          locator: "stub:1",
        },
      ],
    };
    const { mapping } = (await import("@/lib/adapters")).loadMappingFile(GENERIC);
    const report = await dryRun(mapping, { vehicle: stub }, getState(), { entities: ["vehicle"] });
    const v = report.entities[0];
    expect(v.counts).toMatchObject({ accepted: 1, wouldUpdate: 1, wouldCreate: 0, unchanged: 0 });
    expect(v.wouldUpdate[0].canonicalId).toBe("VEH-01");
    expect(v.wouldUpdate[0].differences.map((x) => x.field)).toEqual(expect.arrayContaining(["capacityLbs", "status", "currentDriverId"]));
  });
});
