import { getState } from "../domain/store";
import type { AutonomyLevel, Policy } from "../domain/types";
import { formatMoney } from "../domain/locale";

export const AUTONOMY_LEVELS: readonly AutonomyLevel[] = [
  "OBSERVE",
  "RECOMMEND",
  "LOW_RISK_AUTONOMOUS",
  "OPERATIONAL_AUTONOMOUS",
  "HIGH_IMPACT_APPROVAL",
];

export interface PolicyDecision {
  policy: Policy;
  effectiveLevel: AutonomyLevel;
  requiresApproval: boolean;
  reason: string;
}

/**
 * Evaluate the configured autonomy policy for an action type against its
 * estimated cost. A policy with a maxCost threshold escalates to
 * approval when the estimate exceeds it, even if its base level is
 * autonomous — this is what implements rules like "appointment
 * rescheduling under $100 -> autonomous".
 */
export function evaluatePolicy(actionType: string, estimatedCost: number): PolicyDecision {
  const policy = getState().policies.get(actionType);
  if (!policy) {
    return {
      policy: {
        id: "POL-UNKNOWN",
        actionType,
        label: actionType,
        description: "No policy configured for this action type; defaulting to human approval.",
        autonomyLevel: "HIGH_IMPACT_APPROVAL",
        maxCost: null,
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

  if (policy.maxCost !== null && estimatedCost > policy.maxCost) {
    return {
      policy,
      effectiveLevel: "HIGH_IMPACT_APPROVAL",
      requiresApproval: true,
      reason: `Estimated cost ${formatMoney(estimatedCost)} exceeds the ${formatMoney(policy.maxCost)} autonomous threshold for "${policy.label}"; escalating to approval.`,
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
    reason: `Policy "${policy.label}" permits autonomous execution (estimated cost ${formatMoney(estimatedCost)}${
      policy.maxCost !== null ? ` <= ${formatMoney(policy.maxCost)} threshold` : ""
    }).`,
  };
}

export function listPolicies(): Policy[] {
  return Array.from(getState().policies.values());
}

export function updatePolicy(
  actionType: string,
  updates: Partial<Pick<Policy, "autonomyLevel" | "maxCost">>
): Policy {
  const state = getState();
  const policy = state.policies.get(actionType);
  if (!policy) throw new Error(`Unknown policy action type: ${actionType}`);
  if (!policy.editable) throw new Error(`Policy "${policy.label}" is not editable`);
  // Server Actions are callable with arbitrary arguments, so validate here:
  // an unknown level or a NaN/negative/infinite threshold would silently
  // disable cost escalation (`cost > NaN` is always false).
  if (updates.autonomyLevel !== undefined && !AUTONOMY_LEVELS.includes(updates.autonomyLevel)) {
    throw new Error(`Invalid autonomy level: ${String(updates.autonomyLevel)}`);
  }
  if (
    updates.maxCost !== undefined &&
    updates.maxCost !== null &&
    (typeof updates.maxCost !== "number" || !Number.isFinite(updates.maxCost) || updates.maxCost < 0)
  ) {
    throw new Error("maxCost must be null or a finite, non-negative number");
  }
  const updated: Policy = { ...policy, ...updates };
  state.policies.set(actionType, updated);
  return updated;
}
