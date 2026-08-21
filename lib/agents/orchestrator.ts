import { getState, nextId, nowIso } from "../domain/store";
import type {
  AgentPhase,
  AgentRun,
  AgentStep,
  AutonomyLevel,
  OperationalException,
  RecoveryOption,
  RecoveryOptionType,
  Shipment,
} from "../domain/types";
import { evaluatePolicy } from "./policyEngine";
import { evaluateRecoveryOptions } from "./reasoner";
import { coordinateFacilityReschedule, notifyCustomerOfUpdate, notifyDriverOfReassignment, notifyOpsEscalation } from "./communicationAgent";
import {
  applyEtaImprovement,
  escalateException,
  findAlternativeDriver,
  getShipment,
  reassignShipment,
  recordAgentAction,
  requestApproval,
  rescheduleAppointment,
  resolveException,
  updateRoute,
  ToolExecutionError,
} from "./tools";

// ---------------------------------------------------------------------------
// Core agent orchestration pipeline:
//   Event -> Context -> Reasoning -> Plan -> Policy -> [Approval] ->
//   Tool Execution -> Verification -> State Update -> Audit -> Communication
//
// Every phase transition is recorded as an AgentStep so the Agent Activity
// timeline in the UI reflects exactly what the pipeline did — no private
// chain-of-thought is exposed, only structured phase/label/detail entries.
// See docs/architecture/agent-design.md.
// ---------------------------------------------------------------------------

const OPTION_TO_ACTION_TYPE: Record<RecoveryOptionType, string> = {
  RESCHEDULE_APPOINTMENT: "APPOINTMENT_RESCHEDULE",
  REASSIGN_DRIVER: "DRIVER_REASSIGNMENT",
  ADJUST_ROUTE: "ROUTE_ADJUSTMENT",
  CARRIER_REBOOK: "CARRIER_REBOOK",
  EXPEDITE: "CARRIER_REBOOK",
  NOTIFY_ONLY: "CUSTOMER_NOTIFICATION",
};

function addStep(
  agentRunId: string,
  phase: AgentPhase,
  label: string,
  detail: string,
  status: AgentStep["status"] = "OK"
): AgentStep {
  const step: AgentStep = {
    id: nextId("STEP"),
    agentRunId,
    timestamp: nowIso(),
    phase,
    label,
    detail,
    status,
  };
  getState().agentSteps.push(step);
  return step;
}

function createRun(agentType: AgentRun["agentType"], triggerEventType: string, shipmentId: string | null, exceptionId: string | null): AgentRun {
  const run: AgentRun = {
    id: nextId("RUN"),
    agentType,
    triggerEventType,
    shipmentId,
    exceptionId,
    startedAt: nowIso(),
    completedAt: null,
    status: "RUNNING",
    plan: null,
    selectedActionType: null,
    autonomyLevel: null,
    outcomeSummary: null,
  };
  getState().agentRuns.set(run.id, run);
  return run;
}

function selectedOption(run: AgentRun): RecoveryOption {
  if (!run.plan) throw new ToolExecutionError("orchestrator", `run ${run.id} has no plan`);
  const opt = run.plan.options.find((o) => o.id === run.plan!.selectedOptionId);
  if (!opt) throw new ToolExecutionError("orchestrator", `run ${run.id} plan missing selected option`);
  return opt;
}

/**
 * Executes the concrete tool call(s) for a recovery option. This is the
 * ONLY place the pipeline mutates shipment/driver/route state, and it only
 * runs after policy evaluation (and approval, if required) has cleared it.
 */
function executeOption(run: AgentRun, shipment: Shipment, option: RecoveryOption) {
  const impactMin = option.etaImprovementMin;
  switch (option.type) {
    case "RESCHEDULE_APPOINTMENT": {
      if (!shipment.appointment) throw new ToolExecutionError("executeOption", "no appointment to reschedule");
      const newStart = new Date(new Date(shipment.appointment.start).getTime() + impactMin * 60_000).toISOString();
      const newEnd = new Date(new Date(shipment.appointment.end).getTime() + impactMin * 60_000).toISOString();
      const confirmed = coordinateFacilityReschedule(run, shipment, newStart);
      if (!confirmed) throw new ToolExecutionError("executeOption", "facility declined the proposed appointment window");
      const result = rescheduleAppointment({ shipmentId: shipment.id, newStart, newEnd, agentRunId: run.id });
      recordAgentAction({ agentRunId: run.id, tool: "rescheduleAppointment", input: { shipmentId: shipment.id, newStart, newEnd }, output: result, status: "SUCCESS" });
      applyEtaImprovement({ shipmentId: shipment.id, improvementMin: impactMin, agentRunId: run.id });
      return;
    }
    case "REASSIGN_DRIVER": {
      const alt = findAlternativeDriver({ shipmentId: shipment.id });
      if (!alt) throw new ToolExecutionError("executeOption", "no alternative driver available");
      const result = reassignShipment({ shipmentId: shipment.id, newDriverId: alt.id, agentRunId: run.id });
      recordAgentAction({ agentRunId: run.id, tool: "reassignShipment", input: { shipmentId: shipment.id, newDriverId: alt.id }, output: result, status: "SUCCESS" });
      applyEtaImprovement({ shipmentId: shipment.id, improvementMin: impactMin, agentRunId: run.id });
      return;
    }
    case "ADJUST_ROUTE": {
      const result = updateRoute({ shipmentId: shipment.id, trafficFactor: 1.0, agentRunId: run.id });
      recordAgentAction({ agentRunId: run.id, tool: "updateRoute", input: { shipmentId: shipment.id, trafficFactor: 1.0 }, output: result, status: "SUCCESS" });
      applyEtaImprovement({ shipmentId: shipment.id, improvementMin: impactMin, agentRunId: run.id });
      return;
    }
    case "CARRIER_REBOOK":
    case "EXPEDITE": {
      const result = recordAgentAction({
        agentRunId: run.id,
        tool: "bookExpeditedCarrier",
        input: { shipmentId: shipment.id },
        output: { carrier: "Lonestar Expedite Partners", confirmation: `EXP-${shipment.id}` },
        status: "SUCCESS",
      });
      applyEtaImprovement({ shipmentId: shipment.id, improvementMin: impactMin, agentRunId: run.id });
      void result;
      return;
    }
    case "NOTIFY_ONLY":
      return; // no operational mutation, notification happens in the NOTIFY phase
  }
}

function notifyForOption(run: AgentRun, shipment: Shipment, exception: OperationalException, option: RecoveryOption) {
  notifyCustomerOfUpdate(run, shipment, exception);
  if (option.type === "REASSIGN_DRIVER" && shipment.driverId) {
    notifyDriverOfReassignment(run, shipment, shipment.driverId);
  }
}

function verify(shipment: Shipment): { ok: boolean; detail: string } {
  const withinWindow = new Date(shipment.currentEta).getTime() <= new Date(shipment.deliveryWindowEnd).getTime();
  return {
    ok: withinWindow,
    detail: withinWindow
      ? `Verified: revised ETA ${shipment.currentEta} is within the delivery window (ends ${shipment.deliveryWindowEnd}).`
      : `Verification warning: revised ETA ${shipment.currentEta} still exceeds the delivery window (ends ${shipment.deliveryWindowEnd}).`,
  };
}

function finalizeSuccess(run: AgentRun, exceptionId: string, summary: string) {
  resolveException(exceptionId, run.id, summary);
  run.status = "COMPLETED";
  run.completedAt = nowIso();
  run.outcomeSummary = summary;
  addStep(run.id, "AUDIT", "Audit trail recorded", "All state mutations and tool calls for this run are logged in the audit trail.");
}

/**
 * Main entry point for the Exception Recovery Agent. Runs the full
 * pipeline up to (and including, if autonomous) execution + verification.
 * If human approval is required, the run pauses in AWAITING_APPROVAL and
 * `resumeExceptionRecoveryAfterApproval` continues it once a decision is made.
 */
export async function runExceptionRecoveryAgent(exceptionId: string): Promise<AgentRun> {
  const exception = getState().exceptions.get(exceptionId);
  if (!exception) throw new ToolExecutionError("runExceptionRecoveryAgent", `unknown exception ${exceptionId}`);
  const shipment = getShipment(exception.shipmentId);

  const run = createRun("EXCEPTION_RECOVERY", exception.type, shipment.id, exception.id);
  exception.status = "IN_PROGRESS";

  addStep(run.id, "DETECT", "Exception detected", `${exception.type} on ${shipment.id}: ${exception.description}`);
  addStep(
    run.id,
    "CONTEXT",
    "Shipment context retrieved",
    `${shipment.id} (${shipment.customerName}, ${shipment.priority}) — driver ${shipment.driverId}, destination ${shipment.destinationFacilityId}, window ends ${shipment.deliveryWindowEnd}.`
  );

  addStep(run.id, "REASON", "Evaluating recovery options", "Scoring feasible recovery options against ETA recovery, cost, feasibility, and risk.");
  const plan = await evaluateRecoveryOptions(shipment, exception);
  run.plan = plan;
  const option = plan.options.find((o) => o.id === plan.selectedOptionId)!;
  addStep(
    run.id,
    "PLAN",
    `Recovery option selected: ${option.type.replace(/_/g, " ")}`,
    `${plan.rationale} (confidence ${(plan.confidence * 100).toFixed(0)}%, ${plan.options.length} options considered)`
  );

  const actionType = OPTION_TO_ACTION_TYPE[option.type];
  run.selectedActionType = actionType;
  const policyDecision = evaluatePolicy(actionType, option.estimatedCostUsd);
  run.autonomyLevel = policyDecision.effectiveLevel;
  addStep(run.id, "POLICY", `Autonomy level: ${policyDecision.effectiveLevel}`, policyDecision.reason);

  if (policyDecision.requiresApproval) {
    return requestHumanApproval(run, shipment, exception, option, policyDecision.effectiveLevel);
  }

  return executeAndComplete(run, shipment, exception, option);
}

function requestHumanApproval(
  run: AgentRun,
  shipment: Shipment,
  exception: OperationalException,
  option: RecoveryOption,
  autonomyLevel: AutonomyLevel
): AgentRun {
  addStep(run.id, "APPROVAL", "Escalated for human approval", `${option.type.replace(/_/g, " ")} requires approval under autonomy level ${autonomyLevel}.`);
  requestApproval({
    agentRunId: run.id,
    shipmentId: shipment.id,
    actionType: run.selectedActionType!,
    summary: `${option.type.replace(/_/g, " ")} for ${shipment.id} (${shipment.customerName})`,
    whatWillHappen: option.description,
    why: `${exception.type.replace(/_/g, " ")} added ${exception.etaImpactMin} min, violating the ${shipment.priority.toLowerCase()}-priority delivery window ending ${shipment.deliveryWindowEnd}.`,
    expectedImpact: `Recovers ~${option.etaImprovementMin} min of ETA; ${Math.round(option.feasibility * 100)}% feasibility, risk score ${option.riskScore.toFixed(2)}.`,
    estimatedCostUsd: option.estimatedCostUsd,
    slaImpactMin: exception.etaImpactMin,
    confidence: run.plan!.confidence,
    contextNotes: [
      `Shipment priority: ${shipment.priority}`,
      `Customer: ${shipment.customerName}`,
      `Alternatives considered: ${run.plan!.options.length - 1}`,
    ],
  });
  run.status = "AWAITING_APPROVAL";
  return run;
}

function executeAndComplete(
  run: AgentRun,
  shipment: Shipment,
  exception: OperationalException,
  option: RecoveryOption
): AgentRun {
  try {
    addStep(run.id, "EXECUTE", `Executing ${option.type.replace(/_/g, " ")}`, option.description);
    executeOption(run, shipment, option);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addStep(run.id, "EXECUTE", "Execution failed", message, "ERROR");
    return handleExecutionFailure(run, shipment, exception, message);
  }

  const verification = verify(shipment);
  addStep(run.id, "VERIFY", verification.ok ? "Outcome verified" : "Outcome verification flagged a warning", verification.detail, verification.ok ? "OK" : "WARN");

  if (!verification.ok) {
    return handleExecutionFailure(run, shipment, exception, verification.detail);
  }

  addStep(run.id, "UPDATE", "Shipment state updated", `${shipment.id} current ETA is now ${shipment.currentEta}; status returned to IN_TRANSIT.`);
  if (shipment.status === "EXCEPTION") shipment.status = "IN_TRANSIT";

  addStep(run.id, "NOTIFY", "Stakeholders notified", "Customer notified of the revised ETA; facility/driver notified where applicable.");
  notifyForOption(run, shipment, exception, option);

  finalizeSuccess(run, exception.id, `Resolved via ${option.type.replace(/_/g, " ").toLowerCase()}: ${option.description}`);
  return run;
}

function handleExecutionFailure(run: AgentRun, shipment: Shipment, exception: OperationalException, reason: string): AgentRun {
  // Retry once with the next-best option before escalating — see
  // docs/architecture/agent-design.md "Failure handling".
  const remaining = run.plan!.options.filter((o) => o.id !== run.plan!.selectedOptionId);
  const retryOption = remaining.sort((a, b) => b.score - a.score)[0];
  if (retryOption && retryOption.type !== "NOTIFY_ONLY") {
    addStep(run.id, "PLAN", "Retrying with next-best option", `Primary option failed (${reason}); retrying with ${retryOption.type.replace(/_/g, " ")}.`, "WARN");
    run.plan!.selectedOptionId = retryOption.id;
    try {
      addStep(run.id, "EXECUTE", `Executing ${retryOption.type.replace(/_/g, " ")}`, retryOption.description);
      executeOption(run, shipment, retryOption);
      const verification = verify(shipment);
      addStep(run.id, "VERIFY", verification.ok ? "Outcome verified on retry" : "Retry verification warning", verification.detail, verification.ok ? "OK" : "WARN");
      if (verification.ok) {
        addStep(run.id, "UPDATE", "Shipment state updated", `${shipment.id} current ETA is now ${shipment.currentEta} after retry.`);
        if (shipment.status === "EXCEPTION") shipment.status = "IN_TRANSIT";
        addStep(run.id, "NOTIFY", "Stakeholders notified", "Customer notified of the revised ETA after retry.");
        notifyForOption(run, shipment, exception, retryOption);
        finalizeSuccess(run, exception.id, `Resolved on retry via ${retryOption.type.replace(/_/g, " ").toLowerCase()} after primary option failed.`);
        return run;
      }
    } catch {
      // fall through to escalation
    }
  }

  addStep(run.id, "ESCALATE", "Escalated to human operator", `Unable to safely resolve automatically: ${reason}`, "ERROR");
  escalateException(exception.id, run.id, reason);
  notifyOpsEscalation(run, shipment, reason);
  run.status = "ESCALATED";
  run.completedAt = nowIso();
  run.outcomeSummary = `Escalated — could not resolve automatically: ${reason}`;
  return run;
}

export function resumeExceptionRecoveryAfterApproval(runId: string, approved: boolean, resolvedBy: string): AgentRun {
  const run = getState().agentRuns.get(runId);
  if (!run) throw new ToolExecutionError("resumeExceptionRecoveryAfterApproval", `unknown run ${runId}`);
  if (!run.shipmentId || !run.exceptionId || !run.plan) {
    throw new ToolExecutionError("resumeExceptionRecoveryAfterApproval", `run ${runId} missing context`);
  }
  const shipment = getShipment(run.shipmentId);
  const exception = getState().exceptions.get(run.exceptionId)!;
  const option = selectedOption(run);

  if (!approved) {
    addStep(run.id, "APPROVAL", "Approval rejected", `Human operator (${resolvedBy}) rejected ${option.type.replace(/_/g, " ")}.`, "WARN");
    addStep(run.id, "ESCALATE", "Escalated after rejection", "Recovery action rejected by human operator; exception remains open for manual handling.", "ERROR");
    escalateException(exception.id, run.id, `Approval rejected by ${resolvedBy}`);
    notifyOpsEscalation(run, shipment, `Approval rejected by ${resolvedBy}`);
    run.status = "ESCALATED";
    run.completedAt = nowIso();
    run.outcomeSummary = `Escalated — approval rejected by ${resolvedBy}.`;
    return run;
  }

  addStep(run.id, "APPROVAL", "Approval granted", `Human operator (${resolvedBy}) approved ${option.type.replace(/_/g, " ")}.`);
  return executeAndComplete(run, shipment, exception, option);
}
