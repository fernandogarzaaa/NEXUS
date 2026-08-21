import { getState, nextId, nowIso } from "../domain/store";
import type { AgentPhase, AgentRun, AgentStep, OperationalException, Shipment } from "../domain/types";
import { sendNotification } from "./tools";

// ---------------------------------------------------------------------------
// Communication & Coordination Agent — owns every outbound message the
// system produces as a result of another agent's decision: customer ETA
// updates, facility appointment requests/confirmations, driver instructions,
// and internal escalation alerts. All communications are simulated (no real
// email/SMS/EDI integration in the POC) and represented as Communication
// events plus AgentSteps on the SAME agent run they support, so the Agent
// Activity timeline shows the full cross-agent story in order.
// ---------------------------------------------------------------------------

function addStep(agentRunId: string, phase: AgentPhase, label: string, detail: string, status: AgentStep["status"] = "OK") {
  const step: AgentStep = { id: nextId("STEP"), agentRunId, timestamp: nowIso(), phase, label, detail, status };
  getState().agentSteps.push(step);
  return step;
}

/**
 * Simulates a two-way facility coordination handshake (request + confirm)
 * ahead of an appointment reschedule. Returns whether the facility
 * confirmed capacity for the proposed window.
 */
export function coordinateFacilityReschedule(run: AgentRun, shipment: Shipment, proposedStart: string): boolean {
  const facilityId = shipment.appointment?.facilityId ?? shipment.destinationFacilityId;
  addStep(
    run.id,
    "EXECUTE",
    "[Communication Agent] Facility contacted",
    `Requested new dock appointment at ${facilityId} for ${new Date(proposedStart).toUTCString()}.`
  );
  sendNotification({
    shipmentId: shipment.id,
    channel: "FACILITY",
    recipient: facilityId,
    subject: `Appointment change request for ${shipment.referenceCode}`,
    body: `Requesting to move the dock appointment for ${shipment.referenceCode} to ${new Date(proposedStart).toUTCString()} due to an in-transit delay.`,
    agentRunId: run.id,
  });
  // Deterministic in the POC: facility coordination always confirms once
  // capacity has already been validated by the reasoner's feasibility
  // check — a production integration would await a real EDI/API response.
  addStep(
    run.id,
    "EXECUTE",
    "[Communication Agent] Facility confirmed",
    `${facilityId} confirmed the revised appointment window.`
  );
  return true;
}

export function notifyCustomerOfUpdate(run: AgentRun, shipment: Shipment, exception: OperationalException) {
  const etaLocal = new Date(shipment.currentEta).toUTCString();
  addStep(run.id, "NOTIFY", "[Communication Agent] Customer notified", `Sent revised ETA (${etaLocal}) to ${shipment.customerName}.`);
  return sendNotification({
    shipmentId: shipment.id,
    channel: "CUSTOMER",
    recipient: shipment.customerName,
    subject: `Updated delivery ETA for ${shipment.referenceCode}`,
    body: `Your shipment ${shipment.referenceCode} experienced a ${exception.type.replace(/_/g, " ").toLowerCase()}. Revised ETA: ${etaLocal}. We're actively managing this delivery.`,
    agentRunId: run.id,
  });
}

export function notifyDriverOfReassignment(run: AgentRun, shipment: Shipment, driverId: string) {
  addStep(run.id, "NOTIFY", "[Communication Agent] Driver instructed", `Sent new assignment instructions for ${shipment.referenceCode} to ${driverId}.`);
  return sendNotification({
    shipmentId: shipment.id,
    channel: "DRIVER",
    recipient: driverId,
    subject: `New assignment: ${shipment.referenceCode}`,
    body: `You have been assigned shipment ${shipment.referenceCode} (${shipment.priority} priority) by the Exception Recovery Agent.`,
    agentRunId: run.id,
  });
}

export function notifyOpsEscalation(run: AgentRun, shipment: Shipment, reason: string) {
  addStep(run.id, "NOTIFY", "[Communication Agent] Ops duty manager alerted", `Escalation raised for ${shipment.id}: ${reason}`);
  return sendNotification({
    shipmentId: shipment.id,
    channel: "INTERNAL",
    recipient: "Ops Duty Manager",
    subject: `Escalation: ${shipment.referenceCode} needs manual attention`,
    body: `Agent run ${run.id} could not safely resolve an exception on ${shipment.referenceCode} automatically. Reason: ${reason}`,
    agentRunId: run.id,
  });
}
