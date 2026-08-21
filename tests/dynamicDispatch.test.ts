import { beforeEach, describe, expect, it } from "vitest";
import { getState, resetState } from "@/lib/domain/store";
import { HERO_DRIVER_ID, HERO_SHIPMENT_ID } from "@/lib/domain/seed";
import { evaluateDispatchAssignment, resumeDispatchAfterApproval } from "@/lib/agents/dynamicDispatchAgent";

describe("dynamic dispatch agent", () => {
  beforeEach(() => resetState());

  it("takes no action when the assigned driver has sufficient hours-of-service", () => {
    const result = evaluateDispatchAssignment(HERO_SHIPMENT_ID);
    expect(result.reassignmentNeeded).toBe(false);
    expect(result.run).toBeNull();
  });

  it("flags a delayed driver's shipment and requests approval for reassignment (always high-impact)", () => {
    const state = getState();
    state.drivers.get(HERO_DRIVER_ID)!.status = "DELAYED";

    const result = evaluateDispatchAssignment(HERO_SHIPMENT_ID);
    expect(result.reassignmentNeeded).toBe(true);
    expect(result.run!.status).toBe("AWAITING_APPROVAL");
    expect(result.run!.autonomyLevel).toBe("HIGH_IMPACT_APPROVAL");

    const approval = Array.from(state.approvals.values()).find((a) => a.agentRunId === result.run!.id);
    expect(approval).toBeDefined();
    expect(approval!.actionType).toBe("DRIVER_REASSIGNMENT");
  });

  it("executes the reassignment once a human approves", () => {
    const state = getState();
    state.drivers.get(HERO_DRIVER_ID)!.status = "DELAYED";
    const { run } = evaluateDispatchAssignment(HERO_SHIPMENT_ID);

    const resumed = resumeDispatchAfterApproval(run!.id, true, "Test Dispatcher");
    expect(resumed.status).toBe("COMPLETED");

    const shipment = state.shipments.get(HERO_SHIPMENT_ID)!;
    expect(shipment.driverId).not.toBe(HERO_DRIVER_ID);
  });

  it("escalates instead of reassigning when a human rejects the proposal", () => {
    const state = getState();
    state.drivers.get(HERO_DRIVER_ID)!.status = "DELAYED";
    const { run } = evaluateDispatchAssignment(HERO_SHIPMENT_ID);

    const resumed = resumeDispatchAfterApproval(run!.id, false, "Test Dispatcher");
    expect(resumed.status).toBe("ESCALATED");

    const shipment = state.shipments.get(HERO_SHIPMENT_ID)!;
    expect(shipment.driverId).toBe(HERO_DRIVER_ID); // unchanged
  });

  it("escalates immediately when no alternative driver is available", () => {
    const state = getState();
    state.drivers.get(HERO_DRIVER_ID)!.status = "DELAYED";
    // Make every other driver ineligible.
    for (const driver of state.drivers.values()) {
      if (driver.id !== HERO_DRIVER_ID) driver.status = "OFF_DUTY";
    }

    const result = evaluateDispatchAssignment(HERO_SHIPMENT_ID);
    expect(result.run!.status).toBe("ESCALATED");
    expect(result.run!.outcomeSummary).toMatch(/no alternative driver/i);
  });

  it("sweeps all active shipments and only flags the ones assigned to the at-risk driver", () => {
    const state = getState();
    state.drivers.get(HERO_DRIVER_ID)!.status = "DELAYED";
    const active = Array.from(state.shipments.values()).filter(
      (s) => s.status === "IN_TRANSIT" || s.status === "SCHEDULED"
    );
    const results = active.map((s) => evaluateDispatchAssignment(s.id));
    const flagged = results.filter((r) => r.reassignmentNeeded);

    expect(flagged.length).toBeGreaterThan(0);
    // Every flagged shipment belongs to the delayed driver; none were
    // approved yet, so the assignment on record hasn't changed.
    for (const r of flagged) {
      expect(state.shipments.get(r.shipmentId)?.driverId).toBe(HERO_DRIVER_ID);
    }
    // Untouched shipments (other drivers) were correctly left alone.
    expect(flagged.length).toBeLessThan(active.length);
  });
});
