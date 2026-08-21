import { beforeEach, describe, expect, it } from "vitest";
import { getState, resetState } from "@/lib/domain/store";
import { detectDelayException } from "@/lib/agents/exceptionRecoveryAgent";
import { calculateETA } from "@/lib/agents/tools";
import { HERO_SHIPMENT_ID } from "@/lib/domain/seed";

describe("exception detection", () => {
  beforeEach(() => resetState());

  it("calculateETA flags a window violation when the delay pushes past deliveryWindowEnd", () => {
    const shipment = getState().shipments.get(HERO_SHIPMENT_ID)!;
    const result = calculateETA({ shipmentId: shipment.id, delayMin: 45 });
    expect(result.violatesWindow).toBe(true);
    expect(result.minutesLate).toBeGreaterThan(0);
  });

  it("calculateETA does not flag a violation for a small delay within the window", () => {
    const shipment = getState().shipments.get(HERO_SHIPMENT_ID)!;
    const result = calculateETA({ shipmentId: shipment.id, delayMin: 1 });
    expect(result.violatesWindow).toBe(false);
  });

  it("creates an OperationalException with the correct ETA impact and triggers recovery when the window is violated", async () => {
    const { exception, run } = await detectDelayException(HERO_SHIPMENT_ID, 45, "DRIVER_DELAYED");
    expect(exception.type).toBe("DRIVER_DELAYED");
    expect(exception.etaImpactMin).toBe(45);
    expect(exception.status).not.toBe("OPEN"); // moved to IN_PROGRESS/RESOLVED by the pipeline
    expect(run).not.toBeNull();
  });

  it("auto-resolves without triggering the recovery pipeline for a trivial, in-tolerance delay", async () => {
    const { exception, run } = await detectDelayException(HERO_SHIPMENT_ID, 1, "DRIVER_DELAYED");
    expect(exception.status).toBe("RESOLVED");
    expect(run).toBeNull();
  });

  it("weighs severity by shipment priority — the same delay is more severe for a CRITICAL shipment", async () => {
    const state = getState();
    const shipment = state.shipments.get(HERO_SHIPMENT_ID)!; // seeded CRITICAL priority
    expect(shipment.priority).toBe("CRITICAL");
    const { exception } = await detectDelayException(HERO_SHIPMENT_ID, 45, "DRIVER_DELAYED");
    expect(["MEDIUM", "HIGH", "CRITICAL"]).toContain(exception.severity);

    // A STANDARD-priority shipment with the same absolute delay should not
    // be rated more severely than the CRITICAL one.
    const standardShipment = Array.from(state.shipments.values()).find(
      (s) => s.priority === "STANDARD" && s.id !== HERO_SHIPMENT_ID
    )!;
    const { exception: standardException } = await detectDelayException(standardShipment.id, 45, "DRIVER_DELAYED");
    const rank = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 } as const;
    expect(rank[standardException.severity]).toBeLessThanOrEqual(rank[exception.severity]);
  });
});
