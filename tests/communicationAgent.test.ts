import { beforeEach, describe, expect, it } from "vitest";
import { getState, resetState } from "@/lib/domain/store";
import { HERO_SHIPMENT_ID } from "@/lib/domain/seed";
import { coordinateFacilityReschedule, notifyCustomerOfUpdate, notifyOpsEscalation } from "@/lib/agents/communicationAgent";
import type { AgentRun, OperationalException } from "@/lib/domain/types";

function fakeRun(): AgentRun {
  return {
    id: "RUN-COMM-TEST",
    agentType: "EXCEPTION_RECOVERY",
    triggerEventType: "TEST",
    shipmentId: HERO_SHIPMENT_ID,
    exceptionId: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    status: "RUNNING",
    plan: null,
    selectedActionType: null,
    autonomyLevel: null,
    outcomeSummary: null,
  };
}

describe("communication & coordination agent", () => {
  beforeEach(() => resetState());

  it("simulates a facility contact + confirmation handshake and logs both as steps", () => {
    const run = fakeRun();
    const shipment = getState().shipments.get(HERO_SHIPMENT_ID)!;
    const confirmed = coordinateFacilityReschedule(run, shipment, new Date().toISOString());
    expect(confirmed).toBe(true);

    const steps = getState().agentSteps.filter((s) => s.agentRunId === run.id);
    expect(steps.some((s) => s.label.includes("Facility contacted"))).toBe(true);
    expect(steps.some((s) => s.label.includes("Facility confirmed"))).toBe(true);

    const comm = getState().communications.find((c) => c.agentRunId === run.id && c.channel === "FACILITY");
    expect(comm).toBeDefined();
    expect(comm!.simulated).toBe(true);
  });

  it("notifies the customer with the shipment's revised ETA", () => {
    const run = fakeRun();
    const shipment = getState().shipments.get(HERO_SHIPMENT_ID)!;
    const exception: OperationalException = {
      id: "EXC-TEST",
      shipmentId: shipment.id,
      type: "DRIVER_DELAYED",
      severity: "MEDIUM",
      description: "test",
      etaImpactMin: 45,
      detectedAt: new Date().toISOString(),
      status: "IN_PROGRESS",
      resolutionSummary: null,
      agentRunId: run.id,
      resolvedAt: null,
    };
    const comm = notifyCustomerOfUpdate(run, shipment, exception);
    expect(comm.channel).toBe("CUSTOMER");
    expect(comm.recipient).toBe(shipment.customerName);
    expect(comm.body).toContain("driver delayed");
  });

  it("alerts the ops duty manager on escalation via an INTERNAL communication", () => {
    const run = fakeRun();
    const shipment = getState().shipments.get(HERO_SHIPMENT_ID)!;
    const comm = notifyOpsEscalation(run, shipment, "could not reschedule");
    expect(comm.channel).toBe("INTERNAL");
    expect(comm.recipient).toBe("Ops Duty Manager");
    expect(comm.body).toContain("could not reschedule");
  });
});
