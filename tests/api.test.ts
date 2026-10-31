import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticateApiRequest, parseApiKeys } from "@/lib/apiAuth";
import { getState, resetState } from "@/lib/domain/store";
import { HERO_SHIPMENT_ID } from "@/lib/domain/seed";
import { runHeroDemo } from "@/lib/sim/heroDemo";
import { GET as shipments } from "@/app/api/v1/shipments/route";
import { GET as shipmentById } from "@/app/api/v1/shipments/[id]/route";
import { GET as drivers } from "@/app/api/v1/drivers/route";
import { GET as driverById } from "@/app/api/v1/drivers/[id]/route";
import { GET as summary } from "@/app/api/v1/summary/route";
import { GET as audit } from "@/app/api/v1/audit/route";
import { GET as exceptions } from "@/app/api/v1/exceptions/route";
import { GET as health } from "@/app/api/v1/health/route";
import { proxy } from "@/proxy";
import { NextRequest } from "next/server";

const SECRET = "s3cret-s3cret-s3cret-s3cret";
const KEYS = JSON.stringify([
  { id: "ops", secret: SECRET, subject: "ops@senor.example", tenantId: "senor-pilot", roles: ["viewer"], scopes: ["read:*"] },
  { id: "narrow", secret: SECRET, subject: "board@senor.example", tenantId: "senor-pilot", roles: ["viewer"], scopes: ["read:summary"] },
  { id: "other", secret: SECRET, subject: "someone@else.example", tenantId: "other-tenant", roles: ["admin"], scopes: ["read:*"] },
]);
const ENV = { NEXUS_API_KEYS: KEYS, NEXUS_TENANT_ID: "senor-pilot" };

function req(path: string, token?: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://nexus.local${path}`, {
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  });
}

describe("API key auth (pure)", () => {
  it("refuses everything when no keys are configured", () => {
    expect(authenticateApiRequest({}, "Bearer ops." + SECRET, "read:summary")).toMatchObject({ ok: false, status: 503, code: "no_keys_configured" });
  });

  it("validates the key list and rejects short secrets and duplicate ids", () => {
    expect(() => parseApiKeys({ NEXUS_API_KEYS: "nope" })).toThrow(/valid JSON/);
    expect(() => parseApiKeys({ NEXUS_API_KEYS: JSON.stringify([{ id: "a", secret: "short", subject: "s", tenantId: "t", roles: ["viewer"], scopes: ["read:*"] }]) })).toThrow(/secret/);
    expect(() =>
      parseApiKeys({
        NEXUS_API_KEYS: JSON.stringify([
          { id: "a", secret: SECRET, subject: "s", tenantId: "t", roles: ["viewer"], scopes: ["read:*"] },
          { id: "a", secret: SECRET, subject: "s", tenantId: "t", roles: ["viewer"], scopes: ["read:*"] },
        ]),
      })
    ).toThrow(/duplicate/);
  });

  it("distinguishes missing, invalid, wrong-tenant and under-scoped credentials", () => {
    expect(authenticateApiRequest(ENV, undefined, "read:summary")).toMatchObject({ ok: false, status: 401, code: "missing_credentials" });
    expect(authenticateApiRequest(ENV, "Bearer ops.wrong", "read:summary")).toMatchObject({ ok: false, status: 401, code: "invalid_key" });
    expect(authenticateApiRequest(ENV, "Bearer ghost." + SECRET, "read:summary")).toMatchObject({ ok: false, status: 401, code: "invalid_key" });
    expect(authenticateApiRequest(ENV, "Bearer other." + SECRET, "read:summary")).toMatchObject({ ok: false, status: 403, code: "wrong_tenant", keyId: "other" });
    expect(authenticateApiRequest(ENV, "Bearer narrow." + SECRET, "read:shipments")).toMatchObject({ ok: false, status: 403, code: "insufficient_scope", keyId: "narrow" });
    expect(authenticateApiRequest(ENV, "Bearer narrow." + SECRET, "read:summary")).toMatchObject({ ok: true, principal: { subject: "board@senor.example" } });
    expect(authenticateApiRequest(ENV, "Bearer ops." + SECRET, "read:audit")).toMatchObject({ ok: true, principal: { keyId: "ops", tenantId: "senor-pilot" } });
  });
});

describe("public read API routes", () => {
  beforeEach(() => {
    resetState();
    vi.stubEnv("NEXUS_API_KEYS", KEYS);
    vi.stubEnv("NEXUS_TENANT_ID", "senor-pilot");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("health needs no key and never returns data", async () => {
    const res = await health();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok", backend: "memory", apiKeysConfigured: 3 });
    expect(JSON.stringify(body)).not.toContain("SHP-");
  });

  it("returns 401 without a key, 403 for a wrong tenant, and audits only recognised keys", async () => {
    const anon = await shipments(req("/api/v1/shipments"));
    expect(anon.status).toBe(401);
    expect(anon.headers.get("www-authenticate")).toBe("Bearer");
    expect(getState().auditLog).toHaveLength(0); // anonymous attempts are not persisted

    const wrongTenant = await shipments(req("/api/v1/shipments", "other." + SECRET));
    expect(wrongTenant.status).toBe(403);
    const denied = getState().auditLog.at(-1)!;
    expect(denied.action).toBe("API_ACCESS_DENIED");
    expect(denied.actorId).toContain("api-key other");
    expect(denied.detail).toContain("GET /api/v1/shipments [read:shipments] -> 403");
  });

  it("lists shipments with filters and pagination, backed by lib/queries", async () => {
    const res = await shipments(req("/api/v1/shipments?priority=CRITICAL&limit=2", "ops." + SECRET, { "x-request-id": "trace-1" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe("trace-1");
    const body = await res.json();
    expect(body.meta).toMatchObject({ requestId: "trace-1", tenantId: "senor-pilot", backend: "memory" });
    expect(body.data.items).toHaveLength(2);
    expect(body.data.items.every((s: { priority: string }) => s.priority === "CRITICAL")).toBe(true);
    expect(body.data.page.total).toBeGreaterThan(2);

    const logged = getState().auditLog.at(-1)!;
    expect(logged).toMatchObject({ action: "API_READ", actorType: "HUMAN", entityType: "ApiRequest", entityId: "trace-1" });
    expect(logged.actorId).toContain("ops@senor.example");
  });

  it("serves shipment detail including agent runs and audit after the hero demo, and 404s unknown ids", async () => {
    await runHeroDemo();
    const ok = await shipmentById(req(`/api/v1/shipments/${HERO_SHIPMENT_ID}`, "ops." + SECRET), { params: Promise.resolve({ id: HERO_SHIPMENT_ID }) });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.data.shipment.id).toBe(HERO_SHIPMENT_ID);
    expect(body.data.agentRuns[0].status).toBe("COMPLETED");
    expect(body.data.exceptions[0].status).toBe("RESOLVED");

    const missing = await shipmentById(req("/api/v1/shipments/SHP-NOPE", "ops." + SECRET), { params: Promise.resolve({ id: "SHP-NOPE" }) });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("not_found");

    const exc = await exceptions(req("/api/v1/exceptions?status=RESOLVED", "ops." + SECRET));
    expect((await exc.json()).data.items).toHaveLength(1);
  });

  it("enforces scope per route and exposes drivers through the tool layer", async () => {
    expect((await summary(req("/api/v1/summary", "narrow." + SECRET))).status).toBe(200);
    expect((await drivers(req("/api/v1/drivers", "narrow." + SECRET))).status).toBe(403);
    const d = await driverById(req("/api/v1/drivers/D-07", "ops." + SECRET), { params: Promise.resolve({ id: "D-07" }) });
    expect((await d.json()).data.id).toBe("D-07");
    const none = await driverById(req("/api/v1/drivers/D-99", "ops." + SECRET), { params: Promise.resolve({ id: "D-99" }) });
    expect(none.status).toBe(404);
  });

  it("exposes the audit log newest-first, including the API's own access events", async () => {
    await shipments(req("/api/v1/shipments", "ops." + SECRET, { "x-request-id": "first" }));
    const res = await audit(req("/api/v1/audit?action=API_READ", "ops." + SECRET, { "x-request-id": "second" }));
    const body = await res.json();
    expect(body.data.items[0].entityId).toBe("first");
    expect(body.data.items.every((a: { action: string }) => a.action === "API_READ")).toBe(true);
  });

  it("is not gated by the UI session cookie: proxy lets /api/v1 through to key auth", async () => {
    vi.stubEnv("NEXUS_ACCESS_TOKEN", "ui-token");
    const api = await proxy(new NextRequest("http://nexus.local/api/v1/shipments"));
    expect(api.status).toBe(200); // NextResponse.next()
    const page = await proxy(new NextRequest("http://nexus.local/shipments"));
    expect(page.status).toBe(307);
  });
});
