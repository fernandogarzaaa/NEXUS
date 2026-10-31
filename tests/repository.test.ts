import { afterEach, describe, expect, it } from "vitest";
import { InMemoryStateRepository } from "@/lib/domain/repository";
import { buildState, deserializeState, serializeState } from "@/lib/domain/state";
import { getRepository, getState, loadState, persistState, resetState, setRepository } from "@/lib/domain/store";
import { DEMO_SEED, HERO_DRIVER_ID, HERO_SHIPMENT_ID } from "@/lib/domain/seed";

describe("StateRepository (in-memory default)", () => {
  afterEach(() => {
    setRepository(new InMemoryStateRepository());
  });

  it("is the default backend and exposes the seeded demo set", () => {
    resetState();
    const repo = getRepository();
    expect(repo.backend).toBe("memory");
    const state = getState();
    expect(state.seed).toBe(DEMO_SEED);
    expect(state.shipments.size).toBe(63);
    expect(state.drivers.size).toBe(10);
    expect(state.vehicles.size).toBe(14);
    expect(state.facilities.size).toBe(5);
    expect(state.routes.size).toBe(63);
    expect(state.policies.size).toBe(5);
    expect(state.shipments.get(HERO_SHIPMENT_ID)?.driverId).toBe(HERO_DRIVER_ID);
  });

  it("returns the same working-set object until reset", () => {
    const a = getState();
    const b = getState();
    expect(a).toBe(b);
    const c = resetState();
    expect(c).not.toBe(a);
    expect(getState()).toBe(c);
  });

  it("load() and persist() are no-ops that keep the working set stable", async () => {
    const before = getState();
    before.demoCompletedAt = "2026-01-01T00:00:00.000Z";
    const loaded = await loadState();
    await persistState();
    expect(loaded).toBe(before);
    expect(getState().demoCompletedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("rebuilds an identical snapshot from the same seed", () => {
    const first = serializeState(resetState());
    const second = serializeState(resetState());
    expect(second).toEqual(first);
  });

  it("round-trips a snapshot through serialize/deserialize", () => {
    const state = buildState();
    state.pendingDispatchProposals.set("RUN-1", "D-02");
    state.auditLog.push({
      id: "AUD-1",
      timestamp: "2026-01-01T00:00:00.000Z",
      actorType: "SYSTEM",
      actorId: "TEST",
      action: "TEST",
      entityType: "Test",
      entityId: "T-1",
      agentRunId: null,
      detail: "round trip",
    });
    const snapshot = serializeState(state);
    const restored = deserializeState(JSON.parse(JSON.stringify(snapshot)));
    expect(serializeState(restored)).toEqual(snapshot);
    expect(restored.pendingDispatchProposals.get("RUN-1")).toBe("D-02");
    expect(restored.policies.get("APPOINTMENT_RESCHEDULE")?.id).toBe("POL-RESCHEDULE-APPT");
  });

  it("lets a different repository be installed behind the same facade", () => {
    const custom = new InMemoryStateRepository(7);
    setRepository(custom);
    expect(getRepository()).toBe(custom);
    expect(getState().seed).toBe(7);
  });
});
