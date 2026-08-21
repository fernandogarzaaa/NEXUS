import { getState } from "../domain/store";
import type { AutonomyLevel, Policy } from "../domain/types";

export interface PolicyDecision {
  policy: Policy;
  effectiveLevel: AutonomyLevel;
  requiresApproval: boolean;
  reason: string;
}

/**
 * Evaluate the configured autonomy policy for an action type against its
 * estimated cost. A policy with a maxCostUsd threshold escalates to
 * approval when the estimate exceeds it, even if its base level is
 * autonomous — this is what implements rules like "appointment
 * rescheduling under $100 -> autonomous".
 */
export function evaluatePolicy(actionType: string, estimatedCostUsd: number): PolicyDecision {
  const policy = getState().policies.get(actionType);
  if (!policy) {
    return {
      policy: {
        id: "POL-UNKNOWN",
        actionType,
        label: actionType,
        description: "No policy configured for this action type; defaulting to human approval.",
        autonomyLevel: "HIGH_IMPACT_APPROVAL",
        maxCostUsd: null,
        editable: false,
      },
      effectiveLevel: "HIGH_IMPACT_APPROVAL",
      requiresApproval: true,
      reason: `No policy defined for action type "${actionType}"; defaulting to human approval.`,
    };
  }

  if (policy.autonomyLevel === "OBSERVE") {
    return {
      policy,
      effectiveLevel: "OBSERVE",
      requiresApproval: false,
      reason: `Policy "${policy.label}" is in observe-only mode; the agent will report but not act.`,
    };
  }

  if (policy.autonomyLevel === "HIGH_IMPACT_APPROVAL") {
    return {
      policy,
      effectiveLevel: "HIGH_IMPACT_APPROVAL",
      requiresApproval: true,
      reason: `Policy "${policy.label}" always requires human approval.`,
    };
  }

  if (policy.maxCostUsd !== null && estimatedCostUsd > policy.maxCostUsd) {
    return {
      policy,
      effectiveLevel: "HIGH_IMPACT_APPROVAL",
      requiresApproval: true,
      reason: `Estimated cost $${estimatedCostUsd.toFixed(2)} exceeds the $${policy.maxCostUsd.toFixed(
        2
      )} autonomous threshold for "${policy.label}"; escalating to approval.`,
    };
  }

  if (policy.autonomyLevel === "RECOMMEND") {
    return {
      policy,
      effectiveLevel: "RECOMMEND",
      requiresApproval: true,
      reason: `Policy "${policy.label}" requires the agent to recommend, not act autonomously.`,
    };
  }

  return {
    policy,
    effectiveLevel: policy.autonomyLevel,
    requiresApproval: false,
    reason: `Policy "${policy.label}" permits autonomous execution (estimated cost $${estimatedCostUsd.toFixed(
      2
    )}${policy.maxCostUsd !== null ? ` <= $${policy.maxCostUsd.toFixed(2)} threshold` : ""}).`,
  };
}

export function listPolicies(): Policy[] {
  return Array.from(getState().policies.values());
}

export function updatePolicy(
  actionType: string,
  updates: Partial<Pick<Policy, "autonomyLevel" | "maxCostUsd">>
): Policy {
  const state = getState();
  const policy = state.policies.get(actionType);
  if (!policy) throw new Error(`Unknown policy action type: ${actionType}`);
  if (!policy.editable) throw new Error(`Policy "${policy.label}" is not editable`);
  const updated: Policy = { ...policy, ...updates };
  state.policies.set(actionType, updated);
  return updated;
}
