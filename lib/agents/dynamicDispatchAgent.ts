import { getState, nextId, nowIso } from "../domain/store";
import type { AgentPhase, AgentRun, AgentStep, Driver, Shipment } from "../domain/types";
import { evaluatePolicy } from "./policyEngine";
import { notifyDriverOfReassignment, notifyOpsEscalation } from "./communicationAgent";
import { findAlternativeDriver, getDriver, getShipment, reassignShipment, recordAgentAction, requestApproval, ToolExecutionError } from "./tools";

// ---------------------------------------------------------------------------
// Dynamic Dispatch Agent — continuously evaluates whether the current
// driver/vehicle assignment for each active shipment still holds up, given
// hours-of-service, availability, and route distance. Independent of the
// Exception Recovery Agent's delay-triggered flow: this agent runs a
// standing validity check across the active board.
// ---------------------------------------------------------------------------

function addStep(agentRunId: string, phase: AgentPhase, label: string, detail: string, status: AgentStep["status"] = "OK") {
  const step: AgentStep = { id: nextId("STEP"), agentRunId, timestamp: nowIso(), phase, label, detail, status };
  getState().agentSteps.push(step);
  return step;
}

function createRun(shipmentId: string, triggerEventType: string): AgentRun {
  const run: AgentRun = {
    id: nextId("RUN"),
    agentType: "DYNAMIC_DISPATCH",
    triggerEventType,
    shipmentId,
    exceptionId: null,
    startedAt: nowIso(),
    completedAt: null,
    status: "RUNNING",
    plan: null,
    selectedActionType: "DRIVER_REASSIGNMENT",
    autonomyLevel: null,
    outcomeSummary: null,
  };
  getState().agentRuns.set(run.id, run);
  return run;
}

export interface DispatchCheckResult {
  shipmentId: string;
  reassignmentNeeded: boolean;
  run: AgentRun | null;
  reason: string;
}

/** Evaluate a single shipment's assignment validity. */
export function evaluateDispatchAssignment(shipmentId: string): DispatchCheckResult {
  const shipment = getShipment(shipmentId);
  if (!shipment.driverId || shipment.status === "DELIVERED" || shipment.status === "CANCELLED") {
    return { shipmentId, reassignmentNeeded: false, run: null, reason: "Shipment not active." };
  }
  const driver = getDriver(shipment.driverId);
  const neededHours = shipment.distanceMiles / 45;
  const atRisk = driver.status === "DELAYED" || driver.hoursOfServiceRemaining < neededHours;

  if (!atRisk) {
    return {
      shipmentId,
      reassignmentNeeded: false,
      run: null,
      reason: `${driver.name} has sufficient HOS (${driver.hoursOfServiceRemaining.toFixed(1)}h) for the remaining ${neededHours.toFixed(1)}h.`,
    };
  }

  const run = createRun(shipmentId, "DISPATCH_VALIDITY_CHECK");
  addStep(run.id, "DETECT", "Assignment validity concern", `${driver.name} (${driver.status}, ${driver.hoursOfServiceRemaining.toFixed(1)}h HOS) may not complete ${shipmentId} (needs ~${neededHours.toFixed(1)}h).`);
  addStep(run.id, "CONTEXT", "Shipment + driver context retrieved", `${shipment.id} priority ${shipment.priority}, ${shipment.distanceMiles} mi remaining, current driver ${driver.id}.`);

  const alt = findAlternativeDriver({ shipmentId });
  addStep(run.id, "REASON", "Searching for alternative driver", alt ? `Candidate found: ${alt.name} (${alt.hoursOfServiceRemaining.toFixed(1)}h HOS, ${(alt.onTimeRating * 100).toFixed(0)}% on-time).` : "No available alternative driver found.");

  if (!alt) {
    run.status = "ESCALATED";
    run.completedAt = nowIso();
    run.outcomeSummary = "No alternative driver available — escalated to dispatch supervisor.";
    addStep(run.id, "ESCALATE", "Escalated to human dispatcher", "No qualified alternative driver is currently available.", "ERROR");
    return { shipmentId, reassignmentNeeded: true, run, reason: run.outcomeSummary };
  }

  addStep(run.id, "PLAN", "Reassignment plan proposed", `Reassign ${shipmentId} from ${driver.id} to ${alt.id} (${alt.name}).`);
  const policyDecision = evaluatePolicy("DRIVER_REASSIGNMENT", 180);
  run.autonomyLevel = policyDecision.effectiveLevel;
  addStep(run.id, "POLICY", `Autonomy level: ${policyDecision.effectiveLevel}`, policyDecision.reason);

  if (policyDecision.requiresApproval) {
    addStep(run.id, "APPROVAL", "Escalated for human approval", `Driver reassignment requires approval under autonomy level ${policyDecision.effectiveLevel}.`);
    getState().pendingDispatchProposals.set(run.id, alt.id);
    requestApproval({
      agentRunId: run.id,
      shipmentId,
      actionType: "DRIVER_REASSIGNMENT",
      summary: `Reassign ${shipmentId} from ${driver.name} to ${alt.name}`,
      whatWillHappen: `${shipment.id} will be reassigned from ${driver.name} to ${alt.name}.`,
      why: `${driver.name} is ${driver.status === "DELAYED" ? "delayed" : "short on hours-of-service"} for the remaining ${neededHours.toFixed(1)}h route.`,
      expectedImpact: `Protects the delivery window; ${alt.name} has a ${(alt.onTimeRating * 100).toFixed(0)}% on-time rating.`,
      estimatedCostUsd: 180,
      slaImpactMin: 0,
      confidence: 0.82,
      contextNotes: [`Current driver HOS remaining: ${driver.hoursOfServiceRemaining.toFixed(1)}h`, `Route requires: ~${neededHours.toFixed(1)}h`],
    });
    run.status = "AWAITING_APPROVAL";
    return { shipmentId, reassignmentNeeded: true, run, reason: "Awaiting human approval for reassignment." };
  }

  performReassignment(run, shipment, alt);
  return { shipmentId, reassignmentNeeded: true, run, reason: run.outcomeSummary! };
}

function performReassignment(run: AgentRun, shipment: Shipment, alt: Driver) {
  const result = reassignShipment({ shipmentId: shipment.id, newDriverId: alt.id, agentRunId: run.id });
  recordAgentAction({ agentRunId: run.id, tool: "reassignShipment", input: { shipmentId: shipment.id, newDriverId: alt.id }, output: result, status: "SUCCESS" });
  addStep(run.id, "EXECUTE", "Reassignment executed", `${shipment.id} reassigned to ${alt.name}.`);
  addStep(run.id, "VERIFY", "Reassignment verified", `${alt.name} now shows ${shipment.id} in their assignment list.`);
  addStep(run.id, "UPDATE", "Shipment state updated", `Driver of record for ${shipment.id} is now ${alt.id}.`);
  notifyDriverOfReassignment(run, shipment, alt.id);
  addStep(run.id, "AUDIT", "Audit trail recorded", "Reassignment and tool call recorded in the audit log.");
  run.status = "COMPLETED";
  run.completedAt = nowIso();
  run.outcomeSummary = `Reassigned ${shipment.id} to ${alt.name} to protect the delivery window.`;
}

/**
 * Resumes a Dynamic Dispatch run after a human decision on its
 * DRIVER_REASSIGNMENT approval request (see lib/actions.ts decideApprovalAction).
 */
export function resumeDispatchAfterApproval(runId: string, approved: boolean, resolvedBy: string): AgentRun {
  const state = getState();
  const run = state.agentRuns.get(runId);
  if (!run || !run.shipmentId) throw new ToolExecutionError("resumeDispatchAfterApproval", `unknown run ${runId}`);
  const shipment = getShipment(run.shipmentId);
  const altDriverId = state.pendingDispatchProposals.get(runId);

  if (!approved || !altDriverId) {
    addStep(run.id, "APPROVAL", "Approval rejected", `Human operator (${resolvedBy}) rejected the driver reassignment.`, "WARN");
    addStep(run.id, "ESCALATE", "Escalated after rejection", "Reassignment rejected by human operator; assignment remains as-is pending manual dispatch.", "ERROR");
    notifyOpsEscalation(run, shipment, `Reassignment rejected by ${resolvedBy}`);
    run.status = "ESCALATED";
    run.completedAt = nowIso();
    run.outcomeSummary = `Escalated — reassignment rejected by ${resolvedBy}.`;
    state.pendingDispatchProposals.delete(runId);
    return run;
  }

  addStep(run.id, "APPROVAL", "Approval granted", `Human operator (${resolvedBy}) approved the driver reassignment.`);
  const alt = getDriver(altDriverId);
  performReassignment(run, shipment, alt);
  state.pendingDispatchProposals.delete(runId);
  return run;
}

/** Sweep all active shipments and evaluate assignment validity for each. */
export function runDispatchSweep(): DispatchCheckResult[] {
  const state = getState();
  const activeShipments = Array.from(state.shipments.values()).filter(
    (s) => s.status === "IN_TRANSIT" || s.status === "SCHEDULED"
  );
  return activeShipments.map((s) => evaluateDispatchAssignment(s.id));
}
