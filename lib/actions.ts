"use server";

import { revalidatePath } from "next/cache";
import { resumeExceptionRecoveryAfterApproval } from "./agents/orchestrator";
import { evaluateDispatchAssignment, resumeDispatchAfterApproval, runDispatchSweep } from "./agents/dynamicDispatchAgent";
import { simulateRandomEvent } from "./sim/simulator";
import { runHeroDemo } from "./sim/heroDemo";
import { updatePolicy } from "./agents/policyEngine";
import { getState, loadState, persistState, resetState } from "./domain/store";
import type { AutonomyLevel } from "./domain/types";
import { actorLabel, assertAuthorized, type UiPrincipal } from "./authServer";
import type { UiRole } from "./auth";
import { decideApproval, recordHumanAction } from "./agents/tools";

function refreshAll() {
  revalidatePath("/", "layout");
}

/**
 * Every Server Action is a mutation boundary: hydrate the working set from
 * the active backend first (a no-op in memory), run the mutation against
 * the synchronous tool layer, then flush and refresh.
 */
async function mutate(roles: UiRole[], fn: (principal: UiPrincipal) => Promise<void> | void): Promise<void> {
  const principal = await assertAuthorized(...roles);
  await loadState();
  await fn(principal);
  await persistState();
  refreshAll();
}

const OPERATE: UiRole[] = ["operator", "admin"];
const ADMIN: UiRole[] = ["admin"];

export async function runHeroDemoAction() {
  await mutate(OPERATE, async () => {
    await runHeroDemo();
  });
}

export async function simulateRandomEventAction() {
  await mutate(OPERATE, async () => {
    const seed = Date.now() % 1_000_000;
    await simulateRandomEvent(seed);
  });
}

export async function runDispatchSweepAction() {
  await mutate(OPERATE, () => {
    runDispatchSweep();
  });
}

export async function evaluateDispatchAction(shipmentId: string) {
  await mutate(OPERATE, () => {
    evaluateDispatchAssignment(shipmentId);
  });
}

/**
 * The approver is always the signed-in principal. There is deliberately no
 * "resolvedBy" argument: Server Action arguments are caller-controlled.
 */
export async function decideApprovalAction(approvalId: string, approve: boolean) {
  await mutate(OPERATE, (principal) => {
    const decidedBy = actorLabel(principal);
    const { approval, changed } = decideApproval({ approvalId, approve, decidedBy });
    if (!changed) return; // already decided — idempotent no-op (double-click, retry, stale page)
    const run = getState().agentRuns.get(approval.agentRunId);
    if (run?.agentType === "DYNAMIC_DISPATCH") {
      resumeDispatchAfterApproval(approval.agentRunId, approve, decidedBy);
    } else {
      resumeExceptionRecoveryAfterApproval(approval.agentRunId, approve, decidedBy);
    }
  });
}

export async function updatePolicyAction(actionType: string, autonomyLevel: AutonomyLevel, maxCostUsd: number | null) {
  await mutate(ADMIN, (principal) => {
    const before = getState().policies.get(actionType);
    const updated = updatePolicy(actionType, { autonomyLevel, maxCostUsd });
    recordHumanAction({
      actorId: actorLabel(principal),
      action: "UPDATE_POLICY",
      entityType: "Policy",
      entityId: updated.id,
      detail: `${actionType}: ${before?.autonomyLevel} / ${before?.maxCostUsd ?? "no limit"} -> ${updated.autonomyLevel} / ${updated.maxCostUsd ?? "no limit"}`,
    });
  });
}

export async function resetDemoAction() {
  await mutate(ADMIN, (principal) => {
    resetState();
    recordHumanAction({
      actorId: actorLabel(principal),
      action: "RESET_STATE",
      entityType: "System",
      entityId: "state",
      detail: `Working set reset to the seeded demo data (seed ${getState().seed}).`,
    });
  });
}
