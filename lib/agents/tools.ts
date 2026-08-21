import { z } from "zod";
import { getState, nextId, nowIso } from "../domain/store";
import type {
  AgentAction,
  Approval,
  AuditEvent,
  Communication,
  CommunicationChannel,
  Driver,
  Facility,
  OperationalException,
  Route,
  Shipment,
  Vehicle,
} from "../domain/types";

// ---------------------------------------------------------------------------
// Typed tool layer. This is the ONLY surface through which agent reasoning
// is permitted to touch operational state. Every tool call is validated
// against a zod schema before it executes, and every state mutation writes
// an AuditEvent — see docs/architecture/agent-design.md.
// ---------------------------------------------------------------------------

export class ToolValidationError extends Error {
  constructor(tool: string, issues: string) {
    super(`Tool "${tool}" received invalid input: ${issues}`);
    this.name = "ToolValidationError";
  }
}

export class ToolExecutionError extends Error {
  constructor(tool: string, reason: string) {
    super(`Tool "${tool}" failed: ${reason}`);
    this.name = "ToolExecutionError";
  }
}

function validate<T>(tool: string, schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ToolValidationError(tool, result.error.issues.map((i) => i.message).join("; "));
  }
  return result.data;
}

function audit(entry: Omit<AuditEvent, "id" | "timestamp">) {
  const state = getState();
  state.auditLog.push({ id: nextId("AUD"), timestamp: nowIso(), ...entry });
}

// -- Read tools --------------------------------------------------------------

export function getShipment(id: string): Shipment {
  const shipment = getState().shipments.get(id);
  if (!shipment) throw new ToolExecutionError("getShipment", `unknown shipment ${id}`);
  return shipment;
}

export function getDriver(id: string): Driver {
  const driver = getState().drivers.get(id);
  if (!driver) throw new ToolExecutionError("getDriver", `unknown driver ${id}`);
  return driver;
}

export function getVehicle(id: string): Vehicle {
  const vehicle = getState().vehicles.get(id);
  if (!vehicle) throw new ToolExecutionError("getVehicle", `unknown vehicle ${id}`);
  return vehicle;
}

export function getFacility(id: string): Facility {
  const facility = getState().facilities.get(id);
  if (!facility) throw new ToolExecutionError("getFacility", `unknown facility ${id}`);
  return facility;
}

const calculateETASchema = z.object({
  shipmentId: z.string(),
  delayMin: z.number(),
});

export interface ETAResult {
  previousEta: string;
  newEta: string;
  minutesLate: number;
  violatesWindow: boolean;
}

export function calculateETA(input: z.infer<typeof calculateETASchema>): ETAResult {
  const { shipmentId, delayMin } = validate("calculateETA", calculateETASchema, input);
  const shipment = getShipment(shipmentId);
  const previousEta = shipment.currentEta;
  const newEtaMs = new Date(previousEta).getTime() + delayMin * 60_000;
  const newEta = new Date(newEtaMs).toISOString();
  const windowEndMs = new Date(shipment.deliveryWindowEnd).getTime();
  const violatesWindow = newEtaMs > windowEndMs;
  const minutesLate = Math.round((newEtaMs - windowEndMs) / 60_000);
  return { previousEta, newEta, minutesLate, violatesWindow };
}

const calculateRouteSchema = z.object({ shipmentId: z.string() });

export function calculateRoute(input: z.infer<typeof calculateRouteSchema>): Route {
  const { shipmentId } = validate("calculateRoute", calculateRouteSchema, input);
  const shipment = getShipment(shipmentId);
  const route = shipment.routeId ? getState().routes.get(shipment.routeId) : undefined;
  if (!route) throw new ToolExecutionError("calculateRoute", `no route for ${shipmentId}`);
  return route;
}

const findAlternativeDriverSchema = z.object({
  shipmentId: z.string(),
  excludeDriverId: z.string().optional(),
});

export function findAlternativeDriver(
  input: z.infer<typeof findAlternativeDriverSchema>
): Driver | null {
  const { shipmentId, excludeDriverId } = validate(
    "findAlternativeDriver",
    findAlternativeDriverSchema,
    input
  );
  const shipment = getShipment(shipmentId);
  const state = getState();
  const candidates = Array.from(state.drivers.values()).filter(
    (d) =>
      d.id !== excludeDriverId &&
      d.id !== shipment.driverId &&
      d.status === "AVAILABLE" &&
      d.hoursOfServiceRemaining >= shipment.distanceMiles / 45
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.onTimeRating - a.onTimeRating || b.hoursOfServiceRemaining - a.hoursOfServiceRemaining);
  return candidates[0];
}

// -- Write tools ---------------------------------------------------------

const rescheduleAppointmentSchema = z.object({
  shipmentId: z.string(),
  newStart: z.string(),
  newEnd: z.string(),
  agentRunId: z.string(),
});

export function rescheduleAppointment(input: z.infer<typeof rescheduleAppointmentSchema>) {
  const { shipmentId, newStart, newEnd, agentRunId } = validate(
    "rescheduleAppointment",
    rescheduleAppointmentSchema,
    input
  );
  const shipment = getShipment(shipmentId);
  if (!shipment.appointment) {
    throw new ToolExecutionError("rescheduleAppointment", `${shipmentId} has no facility appointment`);
  }
  const facility = getFacility(shipment.appointment.facilityId);
  const hour = new Date(newStart).getUTCHours();
  const slot = facility.appointmentCapacity.find((c) => c.hour === hour);
  if (slot && slot.booked >= slot.capacity) {
    throw new ToolExecutionError(
      "rescheduleAppointment",
      `facility ${facility.id} has no capacity at hour ${hour}`
    );
  }
  const before = { ...shipment.appointment };
  if (slot) slot.booked += 1;
  shipment.appointment = { ...shipment.appointment, start: newStart, end: newEnd, status: "RESCHEDULED" };
  shipment.updatedAt = nowIso();
  audit({
    actorType: "AGENT",
    actorId: agentRunId,
    action: "RESCHEDULE_APPOINTMENT",
    entityType: "Shipment",
    entityId: shipmentId,
    agentRunId,
    detail: `Appointment moved from ${before.start} to ${newStart} at ${facility.name}`,
  });
  return shipment.appointment;
}

const reassignShipmentSchema = z.object({
  shipmentId: z.string(),
  newDriverId: z.string(),
  agentRunId: z.string(),
});

export function reassignShipment(input: z.infer<typeof reassignShipmentSchema>) {
  const { shipmentId, newDriverId, agentRunId } = validate(
    "reassignShipment",
    reassignShipmentSchema,
    input
  );
  const shipment = getShipment(shipmentId);
  const newDriver = getDriver(newDriverId);
  const state = getState();
  const oldDriverId = shipment.driverId;
  if (oldDriverId) {
    const oldDriver = state.drivers.get(oldDriverId);
    if (oldDriver) {
      oldDriver.assignedShipmentIds = oldDriver.assignedShipmentIds.filter((s) => s !== shipmentId);
    }
  }
  shipment.driverId = newDriver.id;
  shipment.vehicleId = newDriver.vehicleId ?? shipment.vehicleId;
  shipment.updatedAt = nowIso();
  newDriver.assignedShipmentIds.push(shipmentId);
  newDriver.status = "ON_ROUTE";
  audit({
    actorType: "AGENT",
    actorId: agentRunId,
    action: "REASSIGN_SHIPMENT",
    entityType: "Shipment",
    entityId: shipmentId,
    agentRunId,
    detail: `Reassigned from ${oldDriverId ?? "unassigned"} to ${newDriver.id} (${newDriver.name})`,
  });
  return shipment;
}

const updateRouteSchema = z.object({
  shipmentId: z.string(),
  trafficFactor: z.number().min(0.5).max(3),
  agentRunId: z.string(),
});

export function updateRoute(input: z.infer<typeof updateRouteSchema>) {
  const { shipmentId, trafficFactor, agentRunId } = validate("updateRoute", updateRouteSchema, input);
  const route = calculateRoute({ shipmentId });
  const before = route.trafficFactor;
  route.trafficFactor = trafficFactor;
  audit({
    actorType: "AGENT",
    actorId: agentRunId,
    action: "UPDATE_ROUTE",
    entityType: "Route",
    entityId: route.id,
    agentRunId,
    detail: `Traffic factor adjusted from ${before} to ${trafficFactor}`,
  });
  return route;
}

const sendNotificationSchema = z.object({
  shipmentId: z.string(),
  channel: z.enum(["CUSTOMER", "FACILITY", "DRIVER", "INTERNAL"]),
  recipient: z.string(),
  subject: z.string(),
  body: z.string(),
  agentRunId: z.string().nullable(),
});

export function sendNotification(input: z.infer<typeof sendNotificationSchema>): Communication {
  const { shipmentId, channel, recipient, subject, body, agentRunId } = validate(
    "sendNotification",
    sendNotificationSchema,
    input
  );
  const comm: Communication = {
    id: nextId("COMM"),
    shipmentId,
    agentRunId,
    channel: channel as CommunicationChannel,
    recipient,
    subject,
    body,
    sentAt: nowIso(),
    simulated: true,
  };
  getState().communications.push(comm);
  audit({
    actorType: "AGENT",
    actorId: agentRunId ?? "SYSTEM",
    action: "SEND_NOTIFICATION",
    entityType: "Communication",
    entityId: comm.id,
    agentRunId,
    detail: `${channel} notification to ${recipient}: "${subject}"`,
  });
  return comm;
}

const requestApprovalSchema = z.object({
  agentRunId: z.string(),
  shipmentId: z.string(),
  actionType: z.string(),
  summary: z.string(),
  whatWillHappen: z.string(),
  why: z.string(),
  expectedImpact: z.string(),
  estimatedCostUsd: z.number().min(0),
  slaImpactMin: z.number(),
  confidence: z.number().min(0).max(1),
  contextNotes: z.array(z.string()),
});

export function requestApproval(input: z.infer<typeof requestApprovalSchema>): Approval {
  const parsed = validate("requestApproval", requestApprovalSchema, input);
  const approval: Approval = {
    id: nextId("APR"),
    ...parsed,
    status: "PENDING",
    createdAt: nowIso(),
    resolvedAt: null,
    resolvedBy: null,
  };
  getState().approvals.set(approval.id, approval);
  audit({
    actorType: "AGENT",
    actorId: parsed.agentRunId,
    action: "REQUEST_APPROVAL",
    entityType: "Approval",
    entityId: approval.id,
    agentRunId: parsed.agentRunId,
    detail: `Requested approval for ${parsed.actionType}: ${parsed.summary}`,
  });
  return approval;
}

const recordAgentActionSchema = z.object({
  agentRunId: z.string(),
  tool: z.string(),
  input: z.unknown(),
  output: z.unknown(),
  status: z.enum(["SUCCESS", "FAILED", "RETRIED"]),
  attempt: z.number().default(1),
});

export function recordAgentAction(input: z.input<typeof recordAgentActionSchema>): AgentAction {
  const parsed = validate("recordAgentAction", recordAgentActionSchema, input);
  const idempotencyKey = `${parsed.agentRunId}:${parsed.tool}:${JSON.stringify(parsed.input)}`;
  const existing = getState().agentActions.find((a) => a.idempotencyKey === idempotencyKey && a.status === "SUCCESS");
  if (existing) return existing; // idempotent no-op on replay
  const action: AgentAction = {
    id: nextId("ACT"),
    agentRunId: parsed.agentRunId,
    tool: parsed.tool,
    input: parsed.input,
    output: parsed.output,
    status: parsed.status,
    attempt: parsed.attempt,
    idempotencyKey,
    timestamp: nowIso(),
  };
  getState().agentActions.push(action);
  return action;
}

const applyEtaImprovementSchema = z.object({
  shipmentId: z.string(),
  improvementMin: z.number(),
  agentRunId: z.string(),
});

export function applyEtaImprovement(input: z.infer<typeof applyEtaImprovementSchema>) {
  const { shipmentId, improvementMin, agentRunId } = validate(
    "applyEtaImprovement",
    applyEtaImprovementSchema,
    input
  );
  const shipment = getShipment(shipmentId);
  const before = shipment.currentEta;
  const newEtaMs = new Date(shipment.currentEta).getTime() - improvementMin * 60_000;
  shipment.currentEta = new Date(newEtaMs).toISOString();
  shipment.updatedAt = nowIso();
  audit({
    actorType: "AGENT",
    actorId: agentRunId,
    action: "APPLY_ETA_IMPROVEMENT",
    entityType: "Shipment",
    entityId: shipmentId,
    agentRunId,
    detail: `ETA improved by ${improvementMin} min (from ${before} to ${shipment.currentEta})`,
  });
  return shipment;
}

export function resolveException(
  exceptionId: string,
  agentRunId: string,
  resolutionSummary: string
): OperationalException {
  const exception = getState().exceptions.get(exceptionId);
  if (!exception) throw new ToolExecutionError("resolveException", `unknown exception ${exceptionId}`);
  exception.status = "RESOLVED";
  exception.resolutionSummary = resolutionSummary;
  exception.resolvedAt = nowIso();
  exception.agentRunId = agentRunId;
  audit({
    actorType: "AGENT",
    actorId: agentRunId,
    action: "RESOLVE_EXCEPTION",
    entityType: "OperationalException",
    entityId: exceptionId,
    agentRunId,
    detail: resolutionSummary,
  });
  return exception;
}

export function escalateException(
  exceptionId: string,
  agentRunId: string,
  reason: string
): OperationalException {
  const exception = getState().exceptions.get(exceptionId);
  if (!exception) throw new ToolExecutionError("escalateException", `unknown exception ${exceptionId}`);
  exception.status = "ESCALATED";
  exception.agentRunId = agentRunId;
  audit({
    actorType: "AGENT",
    actorId: agentRunId,
    action: "ESCALATE_EXCEPTION",
    entityType: "OperationalException",
    entityId: exceptionId,
    agentRunId,
    detail: reason,
  });
  return exception;
}
