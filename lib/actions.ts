"use server";

import { revalidatePath } from "next/cache";
import { resumeExceptionRecoveryAfterApproval } from "./agents/orchestrator";
import { evaluateDispatchAssignment, resumeDispatchAfterApproval, runDispatchSweep } from "./agents/dynamicDispatchAgent";
import { simulateRandomEvent } from "./sim/simulator";
import { runHeroDemo } from "./sim/heroDemo";
import { updatePolicy } from "./agents/policyEngine";
import { getState, loadState, persistState, resetState } from "./domain/store";
import type { AutonomyLevel } from "./domain/types";
import { assertAuthorized } from "./authServer";

function refreshAll() {
  revalidatePath("/", "layout");
}

/**
 * Every Server Action is a mutation boundary: hydrate the working set from
 * the active backend first (a no-op in memory), run the mutation against
 * the synchronous tool layer, then flush and refresh.
 */
async function mutate(fn: () => Promise<void> | void): Promise<void> {
  await assertAuthorized();
  await loadState();
  await fn();
  await persistState();
  refreshAll();
}

export async function runHeroDemoAction() {
  await mutate(async () => {
    await runHeroDemo();
  });
}

export async function simulateRandomEventAction() {
  await mutate(async () => {
    const seed = Date.now() % 1_000_000;
    await simulateRandomEvent(seed);
  });
}

export async function runDispatchSweepAction() {
  await mutate(() => {
    runDispatchSweep();
  });
}

export async function evaluateDispatchAction(shipmentId: string) {
  await mutate(() => {
    evaluateDispatchAssignment(shipmentId);
  });
}

export async function decideApprovalAction(approvalId: string, approve: boolean, resolvedBy = "Ops Manager (demo user)") {
  await mutate(() => {
    const state = getState();
    const approval = state.approvals.get(approvalId);
    if (!approval) throw new Error(`Unknown approval ${approvalId}`);
    if (approval.status !== "PENDING") return; // already decided — idempotent no-op (double-click, retry, stale page)
    approval.status = approve ? "APPROVED" : "REJECTED";
    approval.resolvedAt = new Date().toISOString();
    approval.resolvedBy = resolvedBy;
    const run = state.agentRuns.get(approval.agentRunId);
    if (run?.agentType === "DYNAMIC_DISPATCH") {
      resumeDispatchAfterApproval(approval.agentRunId, approve, resolvedBy);
    } else {
      resumeExceptionRecoveryAfterApproval(approval.agentRunId, approve, resolvedBy);
    }
  });
}

export async function updatePolicyAction(actionType: string, autonomyLevel: AutonomyLevel, maxCostUsd: number | null) {
  await mutate(() => {
    updatePolicy(actionType, { autonomyLevel, maxCostUsd });
  });
}

export async function resetDemoAction() {
  await mutate(() => {
    resetState();
  });
}
