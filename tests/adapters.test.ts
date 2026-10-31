import { beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import { resetState, getState } from "@/lib/domain/store";
import { HERO_SHIPMENT_ID } from "@/lib/domain/seed";
import {
  createAdapters,
  loadMappingFile,
  mapRow,
  parseCsv,
  parseMappingFile,
  RestSourceAdapter,
  runReconciliation,
  summarizeReconciliation,
} from "@/lib/adapters";
import type { SourceAdapter } from "@/lib/adapters";

const GENERIC = path.join(process.cwd(), "adapters", "generic", "mapping.json");

describe("csv parser", () => {
  it("handles quotes, escaped quotes, embedded newlines and CRLF", () => {
    const rows = parseCsv('a,b,c\r\n1,"x, y","he said ""hi"""\r\n2,"multi\nline",\r\n');
    expect(rows).toEqual([
      { a: "1", b: "x, y", c: 'he said "hi"' },
      { a: "2", b: "multi\nline", c: "" },
    ]);
  });

  it("returns an empty list for a header-only file and rejects an unterminated quote", () => {
    expect(parseCsv("a,b\n")).toEqual([]);
    expect(() => parseCsv('a\n"oops')).toThrow(/quoted/);
  });
});

describe("mapping evaluation", () => {
  const { mapping } = loadMappingFile(GENERIC);
  const shipment = mapping.entities.shipment!;

  it("maps a clean legacy row to a valid canonical shipment", () => {
    const raw = {
      ConsignmentNo: "1000", RefCode: "NX-817-1000", Consignee: "Lonestar Retail Group", FromDepot: "SAT", ToDepot: "AUS",
      DriverCode: "01", Fleet: "01", Status: "ON ROAD", PriorityCode: "1", WeightKg: "1000", DistanceKm: "160.9",
      WindowFrom: "2026-08-17T14:47:00.000Z", WindowTo: "2026-08-17T17:47:00.000Z", PlannedETA: "2026-08-17T15:47:00.000Z",
      CurrentETA: "2026-08-17T15:47:00.000Z", ApptDepot: "", ApptFrom: "", ApptTo: "", ApptStatus: "",
      Created: "2026-08-17T12:35:00.000Z", Updated: "2026-08-17T14:25:00.000Z",
    };
    const result = mapRow("shipment", shipment, raw, "test:1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record).toMatchObject({
      id: "SHP-1000", driverId: "D-01", vehicleId: "VEH-01", routeId: "RTE-SHP-1000", status: "IN_TRANSIT", priority: "CRITICAL",
      weightLbs: 2205, distanceMiles: 100, appointment: null,
    });
  });

  it("quarantines a row with missing fields, an unmapped enum and a bad number, naming each", () => {
    const result = mapRow("shipment", shipment, { ConsignmentNo: "7", Status: "UNKNOWN", WeightKg: "heavy", DriverCode: "" }, "test:2");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.canonicalId).toBe("SHP-7");
    expect(result.missingFields).toEqual(expect.arrayContaining(["referenceCode", "customerName", "deliveryWindowStart", "createdAt"]));
    expect(result.errors.join("\n")).toMatch(/status: value "UNKNOWN" has no entry/);
    expect(result.errors.join("\n")).toMatch(/weightLbs: "heavy" is not a number/);
  });

  it("rejects a mapping file that is not declared read-only or has unknown keys", () => {
    expect(() => parseMappingFile({ name: "x", system: "y", readOnly: false, entities: {} })).toThrow(/readOnly/);
    expect(() => parseMappingFile({ name: "x", system: "y", readOnly: true, entities: {}, write: {} })).toThrow(/Invalid mapping/);
  });
});

describe("generic csv adapter + reconciliation (proof of the seam)", () => {
  beforeEach(() => resetState());

  it("reports matched, unmatched, duplicate and quarantined shipments against the canonical store", async () => {
    const report = await runReconciliation(GENERIC, getState(), { entities: ["shipment"] });
    const s = report.entities[0];
    expect(s.entity).toBe("shipment");
    expect(s.source.rows).toBe(11);
    expect(s.source.quarantined).toBe(1);
    expect(s.source.mapped).toBe(10);
    expect(s.canonical.rows).toBe(63);

    const matchedIds = s.matched.map((m) => m.canonicalId);
    for (const id of ["SHP-1000", "SHP-1001", "SHP-1002", "SHP-1003", "SHP-1004", "SHP-1005", HERO_SHIPMENT_ID]) {
      expect(matchedIds).toContain(id);
    }
    // The exact duplicate of 1003 matches twice with no differences; the
    // second hero row differs on driver/vehicle and is reported, never merged.
    expect(s.duplicates.bySourceId.map((d) => [d.sourceId, d.count])).toEqual([["1003", 2], ["2000", 2]]);
    expect(s.duplicates.byCanonicalId.map((d) => d.canonicalId)).toEqual(["SHP-1003", HERO_SHIPMENT_ID]);
    const heroRows = s.matched.filter((m) => m.canonicalId === HERO_SHIPMENT_ID);
    expect(heroRows).toHaveLength(2);
    expect(heroRows.some((m) => m.differences.some((d) => d.field === "driverId" && d.source === "D-02"))).toBe(true);
    const clean = s.matched.find((m) => m.canonicalId === "SHP-1000")!;
    expect(clean.differences).toEqual([]);

    expect(s.unmatched).toEqual([{ sourceId: "9999", canonicalId: "SHP-9999", locator: "shipments.csv:11" }]);
    expect(s.missingInSource).toHaveLength(63 - 7);
    expect(s.missingInSource).not.toContain(HERO_SHIPMENT_ID);

    expect(s.quarantined).toHaveLength(1);
    expect(s.quarantined[0].sourceId).toBe("1050");
    expect(s.quarantined[0].missingFields).toContain("customerName");
    expect(s.quarantined[0].errors.join(" ")).toMatch(/status/);
    expect(s.quarantined[0].errors.join(" ")).toMatch(/weightLbs/);
    expect(s.quarantined[0].missingFields).toEqual(["customerName"]); // errored fields are not double-reported as missing

    const summary = summarizeReconciliation(report);
    expect(summary).toContain("shipment  source rows   11");
  });

  it("reconciles every mapped entity and ignores fields the mapping says the source cannot supply", async () => {
    const report = await runReconciliation(GENERIC, getState());
    expect(report.entities.map((e) => e.entity)).toEqual(["shipment", "driver", "vehicle", "facility"]);
    const facilities = report.entities.find((e) => e.entity === "facility")!;
    expect(facilities.matched).toHaveLength(5);
    expect(facilities.matched.every((m) => m.differences.length === 0)).toBe(true);
    const drivers = report.entities.find((e) => e.entity === "driver")!;
    expect(drivers.matched).toHaveLength(10);
    expect(drivers.quarantined.map((q) => q.sourceId)).toEqual(["11"]);
    expect(drivers.quarantined[0].errors.join(" ")).toMatch(/location.lat/);
    const vehicles = report.entities.find((e) => e.entity === "vehicle")!;
    expect(vehicles.matched).toHaveLength(14);
    expect(vehicles.unmatched).toEqual([]);
  });

  it("builds only read-only adapters: a single fetch method and nothing else", () => {
    const adapters = createAdapters(loadMappingFile(GENERIC));
    for (const adapter of Object.values(adapters) as SourceAdapter[]) {
      const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(adapter)).filter((m) => m !== "constructor");
      expect(methods).toEqual(["fetch"]);
    }
  });
});

describe("rest adapter", () => {
  const mapping = parseMappingFile({
    name: "rest-test",
    system: "fake",
    readOnly: true,
    entities: {
      vehicle: {
        source: { type: "rest", url: "https://legacy.example/api/fleet", recordsPath: "data.items", nextUrlPath: "links.next", authEnv: "LEGACY_TOKEN" },
        sourceIdField: "fleetNo",
        fields: {
          id: { template: "VEH-{fleetNo}" },
          type: { from: "body" },
          capacityLbs: { from: "payloadKg", transform: "kgToLbs" },
          status: { from: "state", map: { active: "AVAILABLE", shop: "MAINTENANCE" } },
          currentDriverId: { const: null },
        },
      },
    },
  });

  it("issues GET requests only, sends the bearer token from the environment, and follows pagination", async () => {
    const calls: Array<{ url: string; method: string; auth?: string }> = [];
    const pages: Record<string, unknown> = {
      "https://legacy.example/api/fleet": { data: { items: [{ fleetNo: "01", body: "REEFER", payloadKg: 10000, state: "active" }] }, links: { next: "https://legacy.example/api/fleet?page=2" } },
      "https://legacy.example/api/fleet?page=2": { data: { items: [{ fleetNo: "02", body: "FLATBED", payloadKg: 20000, state: "shop" }] }, links: { next: null } },
    };
    const adapter = new RestSourceAdapter(
      mapping,
      async (url, init) => {
        calls.push({ url, method: init.method, auth: init.headers.authorization });
        return { ok: true, status: 200, json: async () => pages[url] };
      },
      { LEGACY_TOKEN: "secret-token" }
    );
    const rows = await adapter.fetch("vehicle");
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET"]);
    expect(calls.every((c) => c.auth === "Bearer secret-token")).toBe(true);
    expect(rows.map((r) => r.sourceId)).toEqual(["01", "02"]);
    const mapped = rows.map((r) => mapRow("vehicle", mapping.entities.vehicle!, r.raw, r.locator));
    expect(mapped.every((m) => m.ok)).toBe(true);
  });

  it("refuses to run without the named token and surfaces HTTP failures", async () => {
    const noToken = new RestSourceAdapter(mapping, async () => ({ ok: true, status: 200, json: async () => ({}) }), {});
    await expect(noToken.fetch("vehicle")).rejects.toThrow(/LEGACY_TOKEN/);
    const failing = new RestSourceAdapter(mapping, async () => ({ ok: false, status: 503, json: async () => ({}) }), { LEGACY_TOKEN: "t" });
    await expect(failing.fetch("vehicle")).rejects.toThrow(/HTTP 503/);
  });
});
