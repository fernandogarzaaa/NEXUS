"use server";

import { revalidatePath } from "next/cache";
import { resetState } from "./domain/store";
import { resumeExceptionRecoveryAfterApproval } from "./agents/orchestrator";
import { evaluateDispatchAssignment, resumeDispatchAfterApproval, runDispatchSweep } from "./agents/dynamicDispatchAgent";
import { simulateRandomEvent } from "./sim/simulator";
import { runHeroDemo } from "./sim/heroDemo";
import { updatePolicy } from "./agents/policyEngine";
import { getState } from "./domain/store";
import type { AutonomyLevel } from "./domain/types";

function refreshAll() {
  revalidatePath("/", "layout");
}

export async function runHeroDemoAction() {
  await runHeroDemo();
  refreshAll();
}

export async function simulateRandomEventAction() {
  const seed = Date.now() % 1_000_000;
  await simulateRandomEvent(seed);
  refreshAll();
}

export async function runDispatchSweepAction() {
  runDispatchSweep();
  refreshAll();
}

export async function evaluateDispatchAction(shipmentId: string) {
  evaluateDispatchAssignment(shipmentId);
  refreshAll();
}

export async function decideApprovalAction(approvalId: string, approve: boolean, resolvedBy = "Ops Manager (demo user)") {
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
  refreshAll();
}

export async function updatePolicyAction(actionType: string, autonomyLevel: AutonomyLevel, maxCostUsd: number | null) {
  updatePolicy(actionType, { autonomyLevel, maxCostUsd });
  refreshAll();
}

export async function resetDemoAction() {
  resetState();
  refreshAll();
}
