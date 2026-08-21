import { beforeEach, describe, expect, it } from "vitest";
import { resetState } from "@/lib/domain/store";
import { evaluatePolicy, updatePolicy, listPolicies } from "@/lib/agents/policyEngine";

describe("policy engine", () => {
  beforeEach(() => resetState());

  it("allows autonomous execution for a low-cost customer notification", () => {
    const decision = evaluatePolicy("CUSTOMER_NOTIFICATION", 0);
    expect(decision.requiresApproval).toBe(false);
    expect(decision.effectiveLevel).toBe("LOW_RISK_AUTONOMOUS");
  });

  it("allows an appointment reschedule under the $100 autonomous threshold", () => {
    const decision = evaluatePolicy("APPOINTMENT_RESCHEDULE", 25);
    expect(decision.requiresApproval).toBe(false);
  });

  it("escalates an appointment reschedule over the $100 threshold to approval", () => {
    const decision = evaluatePolicy("APPOINTMENT_RESCHEDULE", 150);
    expect(decision.requiresApproval).toBe(true);
    expect(decision.effectiveLevel).toBe("HIGH_IMPACT_APPROVAL");
  });

  it("always requires approval for driver reassignment regardless of cost", () => {
    const cheap = evaluatePolicy("DRIVER_REASSIGNMENT", 1);
    const expensive = evaluatePolicy("DRIVER_REASSIGNMENT", 900);
    expect(cheap.requiresApproval).toBe(true);
    expect(expensive.requiresApproval).toBe(true);
  });

  it("escalates carrier rebooking above its $500 threshold, autonomous below it", () => {
    expect(evaluatePolicy("CARRIER_REBOOK", 300).requiresApproval).toBe(false);
    expect(evaluatePolicy("CARRIER_REBOOK", 650).requiresApproval).toBe(true);
  });

  it("defaults unknown action types to human approval", () => {
    const decision = evaluatePolicy("SOME_UNCONFIGURED_ACTION", 0);
    expect(decision.requiresApproval).toBe(true);
  });

  it("lets an operator tighten a policy at runtime and immediately reflects it", () => {
    updatePolicy("APPOINTMENT_RESCHEDULE", { autonomyLevel: "HIGH_IMPACT_APPROVAL", maxCostUsd: null });
    const decision = evaluatePolicy("APPOINTMENT_RESCHEDULE", 1);
    expect(decision.requiresApproval).toBe(true);
    expect(listPolicies().find((p) => p.actionType === "APPOINTMENT_RESCHEDULE")?.autonomyLevel).toBe(
      "HIGH_IMPACT_APPROVAL"
    );
  });

  it("rejects updates to non-editable or unknown policies", () => {
    expect(() => updatePolicy("NOT_A_REAL_ACTION", { autonomyLevel: "OBSERVE" })).toThrow();
  });
});
