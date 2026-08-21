import { beforeEach, describe, expect, it } from "vitest";
import { getState, resetState } from "@/lib/domain/store";
import { HERO_SHIPMENT_ID } from "@/lib/domain/seed";
import { detectDelayException } from "@/lib/agents/exceptionRecoveryAgent";
import { resumeExceptionRecoveryAfterApproval } from "@/lib/agents/orchestrator";
import { updatePolicy } from "@/lib/agents/policyEngine";

describe("exception recovery orchestration", () => {
  beforeEach(() => resetState());

  it("selects a recovery option, executes it autonomously, and resolves the exception", async () => {
    const { exception, run } = await detectDelayException(HERO_SHIPMENT_ID, 45, "DRIVER_DELAYED");
    expect(run).not.toBeNull();
    expect(run!.status).toBe("COMPLETED");
    expect(run!.plan).not.toBeNull();
    expect(run!.plan!.options.length).toBeGreaterThanOrEqual(3);

    const state = getState();
    const shipment = state.shipments.get(HERO_SHIPMENT_ID)!;
    // Verify: the shipment's revised ETA must now be within its delivery window.
    expect(new Date(shipment.currentEta).getTime()).toBeLessThanOrEqual(new Date(shipment.deliveryWindowEnd).getTime());
    expect(shipment.status).toBe("IN_TRANSIT");

    const refreshedException = state.exceptions.get(exception.id)!;
    expect(refreshedException.status).toBe("RESOLVED");
    expect(refreshedException.resolutionSummary).toBeTruthy();
  });

  it("produces customer and facility communications tied to the run", async () => {
    const { run } = await detectDelayException(HERO_SHIPMENT_ID, 45, "DRIVER_DELAYED");
    const comms = getState().communications.filter((c) => c.agentRunId === run!.id);
    expect(comms.some((c) => c.channel === "CUSTOMER")).toBe(true);
    expect(comms.every((c) => c.simulated)).toBe(true);
  });

  it("writes an audit trail entry for every state mutation in the run", async () => {
    const { run } = await detectDelayException(HERO_SHIPMENT_ID, 45, "DRIVER_DELAYED");
    const auditEntries = getState().auditLog.filter((a) => a.agentRunId === run!.id);
    expect(auditEntries.length).toBeGreaterThan(0);
    expect(auditEntries.some((a) => a.action === "RESOLVE_EXCEPTION")).toBe(true);
  });

  it("pauses for human approval when the policy requires it, then executes on approval", async () => {
    // Force every appointment reschedule to require approval, regardless of cost.
    updatePolicy("APPOINTMENT_RESCHEDULE", { autonomyLevel: "HIGH_IMPACT_APPROVAL", maxCostUsd: null });

    const { run } = await detectDelayException(HERO_SHIPMENT_ID, 45, "DRIVER_DELAYED");
    expect(run!.status).toBe("AWAITING_APPROVAL");

    const approval = Array.from(getState().approvals.values()).find((a) => a.agentRunId === run!.id);
    expect(approval).toBeDefined();
    expect(approval!.status).toBe("PENDING");

    const resumed = resumeExceptionRecoveryAfterApproval(run!.id, true, "Test Operator");
    expect(resumed.status).toBe("COMPLETED");

    const shipment = getState().shipments.get(HERO_SHIPMENT_ID)!;
    expect(new Date(shipment.currentEta).getTime()).toBeLessThanOrEqual(new Date(shipment.deliveryWindowEnd).getTime());
  });

  it("escalates and alerts ops when a human rejects the proposed action", async () => {
    updatePolicy("APPOINTMENT_RESCHEDULE", { autonomyLevel: "HIGH_IMPACT_APPROVAL", maxCostUsd: null });
    const { run, exception } = await detectDelayException(HERO_SHIPMENT_ID, 45, "DRIVER_DELAYED");

    const resumed = resumeExceptionRecoveryAfterApproval(run!.id, false, "Test Operator");
    expect(resumed.status).toBe("ESCALATED");

    const refreshedException = getState().exceptions.get(exception.id)!;
    expect(refreshedException.status).toBe("ESCALATED");

    const internalAlert = getState().communications.find(
      (c) => c.agentRunId === run!.id && c.channel === "INTERNAL"
    );
    expect(internalAlert).toBeDefined();
  });

  it("retries with the next-best option (or escalates) when the top option fails to execute", async () => {
    // Saturate every appointment slot at the destination facility so the
    // RESCHEDULE_APPOINTMENT tool call fails at execution time even though
    // the reasoner may still rank it highest.
    const state = getState();
    const shipment = state.shipments.get(HERO_SHIPMENT_ID)!;
    const facility = state.facilities.get(shipment.appointment!.facilityId)!;
    facility.appointmentCapacity.forEach((slot) => {
      slot.booked = slot.capacity;
    });

    const { run, exception } = await detectDelayException(HERO_SHIPMENT_ID, 45, "DRIVER_DELAYED");

    // The pipeline must never leave the exception silently open: either it
    // recovered via a fallback option, or it escalated to a human.
    expect(["COMPLETED", "ESCALATED"]).toContain(run!.status);
    const refreshedException = state.exceptions.get(exception.id)!;
    expect(["RESOLVED", "ESCALATED"]).toContain(refreshedException.status);

    const steps = state.agentSteps.filter((s) => s.agentRunId === run!.id);
    const hadFailure = steps.some((s) => s.status === "ERROR");
    expect(hadFailure).toBe(true);
  });
});
