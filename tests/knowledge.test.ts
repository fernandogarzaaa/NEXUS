import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getState, resetState } from "@/lib/domain/store";
import { HERO_SHIPMENT_ID } from "@/lib/domain/seed";
import { runHeroDemo } from "@/lib/sim/heroDemo";
import { ask, buildKnowledgeIndex, getKnowledgeIndex } from "@/lib/knowledge";
import { tokenize, extractIds } from "@/lib/knowledge/text";
import { GET as askRoute } from "@/app/api/v1/ask/route";

const OPS = path.join(process.cwd(), "docs", "ops");

describe("knowledge text", () => {
  it("keeps ids whole and stems simple suffixes", () => {
    expect(tokenize("Why was SHP-2000 delayed by D-07?")).toEqual(["shp-2000", "d-07", "delay"]);
    expect(extractIds("ref NX-817-HERO and fac-aus")).toEqual(["NX-817-HERO", "FAC-AUS"]);
  });
});

describe("knowledge retrieval", () => {
  beforeEach(() => resetState());

  it("answers from a canonical record with a numbered citation and its timestamp", () => {
    const state = getState();
    const index = buildKnowledgeIndex(state, OPS);
    const res = ask(index, state, "What is the status of SHP-2000?");
    expect(res.status).toBe("ANSWERED");
    if (res.status !== "ANSWERED") return;
    expect(res.citations[0]).toMatchObject({ n: 1, sourceType: "shipment", sourceId: HERO_SHIPMENT_ID, asOfBasis: "record" });
    expect(res.citations[0].asOf).toBe(state.shipments.get(HERO_SHIPMENT_ID)!.updatedAt);
    expect(res.answer).toContain("[1]");
    // Every passage mentions the asked id: no unrelated records leak in.
    expect(res.passages.every((p) => p.text.includes(HERO_SHIPMENT_ID))).toBe(true);
  });

  it("returns NOT_FOUND for an id that does not exist instead of the nearest match", () => {
    const state = getState();
    const res = ask(buildKnowledgeIndex(state, OPS), state, "Where is SHP-4242?");
    expect(res).toMatchObject({ status: "NOT_FOUND", reason: "No record found for SHP-4242." });
  });

  it("returns NOT_FOUND for questions nothing indexed covers", () => {
    const state = getState();
    const res = ask(buildKnowledgeIndex(state, OPS), state, "What is the invoice total for customer Woolworths in Perth?");
    expect(res.status).toBe("NOT_FOUND");
  });

  it("answers from ops docs and cites file, section and file time", () => {
    const state = getState();
    const res = ask(buildKnowledgeIndex(state, OPS), state, "What happens when an approval is rejected?", { sourceTypes: ["opsDoc"] });
    expect(res.status).toBe("ANSWERED");
    if (res.status !== "ANSWERED") return;
    expect(res.citations[0]).toMatchObject({ sourceType: "opsDoc", sourceId: "exception-handling.md", asOfBasis: "file" });
    expect(res.citations[0].title).toContain("§ Failure and escalation");
  });

  it("finds what the agents did after the hero demo", async () => {
    await runHeroDemo();
    const state = getState();
    const res = ask(getKnowledgeIndex(state, OPS), state, "How was the exception on SHP-2000 resolved?", { sourceTypes: ["exception"] });
    expect(res.status).toBe("ANSWERED");
    if (res.status !== "ANSWERED") return;
    expect(res.answer).toMatch(/Resolution: Resolved via reschedule appointment/);
  });

  it("excludes a passage whose source changed after indexing and refuses to guess", () => {
    const state = getState();
    const index = buildKnowledgeIndex(state, OPS);
    state.shipments.get(HERO_SHIPMENT_ID)!.status = "DELIVERED"; // changed behind the index's back
    const res = ask(index, state, "status of SHP-2000", { sourceTypes: ["shipment"] });
    expect(res.status).toBe("NOT_FOUND");
    if (res.status !== "NOT_FOUND") return;
    expect(res.excluded).toEqual([expect.objectContaining({ sourceId: HERO_SHIPMENT_ID, reason: "STALE" })]);
    // A fresh index sees the new fact.
    const fresh = ask(buildKnowledgeIndex(state, OPS), state, "status of SHP-2000", { sourceTypes: ["shipment"] });
    expect(fresh.status === "ANSWERED" && fresh.answer).toContain("Status DELIVERED");
  });

  it("excludes a passage whose source was deleted", () => {
    const state = getState();
    const index = buildKnowledgeIndex(state, OPS);
    state.drivers.delete("D-02");
    const res = ask(index, state, "Priya Nair driver D-02", { sourceTypes: ["driver"] });
    expect(res.status).toBe("NOT_FOUND");
  });

  it("rejects records older than maxAgeHours", () => {
    const state = getState();
    const index = buildKnowledgeIndex(state, OPS);
    const res = ask(index, state, "status of SHP-2000", { sourceTypes: ["shipment"], maxAgeHours: 1, now: new Date("2026-10-31T00:00:00Z") });
    expect(res.status).toBe("NOT_FOUND");
    if (res.status !== "NOT_FOUND") return;
    expect(res.excluded[0]).toMatchObject({ reason: "TOO_OLD" });
  });

  it("detects an edited ops-doc section as stale", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-ops-"));
    fs.writeFileSync(path.join(dir, "dock.md"), "# Dock hours\nThe Canberra dock opens at 07:00.\n");
    const state = getState();
    const index = buildKnowledgeIndex(state, dir);
    expect(ask(index, state, "When does the Canberra dock open?", { sourceTypes: ["opsDoc"] }).status).toBe("ANSWERED");
    fs.writeFileSync(path.join(dir, "dock.md"), "# Dock hours\nThe Canberra dock opens at 05:00.\n");
    const res = ask(index, state, "When does the Canberra dock open?", { sourceTypes: ["opsDoc"] });
    expect(res.status).toBe("NOT_FOUND");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("rebuilds the cached index after a mutation that writes audit", async () => {
    const state = getState();
    const first = getKnowledgeIndex(state, OPS);
    expect(getKnowledgeIndex(state, OPS)).toBe(first);
    await runHeroDemo();
    expect(getKnowledgeIndex(state, OPS)).not.toBe(first);
  });
});

describe("GET /api/v1/ask", () => {
  const SECRET = "s3cret-s3cret-s3cret-s3cret";
  beforeEach(() => {
    resetState();
    vi.stubEnv("NEXUS_API_KEYS", JSON.stringify([{ id: "ops", secret: SECRET, subject: "ops@senor.example", tenantId: "demo", roles: ["viewer"], scopes: ["read:knowledge"] }]));
  });
  afterEach(() => vi.unstubAllEnvs());

  const call = (q: string) => askRoute(new Request(`http://nexus.local/api/v1/ask?${q}`, { headers: { authorization: `Bearer ops.${SECRET}` } }));

  it("returns a cited answer and audits the read", async () => {
    const res = await call("q=" + encodeURIComponent("status of SHP-2000"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("ANSWERED");
    expect(body.data.citations[0].sourceId).toBe(HERO_SHIPMENT_ID);
    expect(getState().auditLog.at(-1)).toMatchObject({ action: "API_READ" });
  });

  it("validates input", async () => {
    expect((await call("q=")).status).toBe(400);
    expect((await call("q=x&maxAgeHours=-1")).status).toBe(400);
    expect((await call("q=x&types=invoice")).status).toBe(400);
  });
});
