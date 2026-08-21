import { getState } from "./domain/store";
import type {
  AgentAction,
  AgentRun,
  AgentStep,
  Approval,
  AuditEvent,
  Communication,
  Driver,
  Facility,
  OperationalException,
  Policy,
  Route,
  Shipment,
  Vehicle,
} from "./domain/types";

// Read-side selectors shaping in-memory store state for the UI. Kept
// separate from lib/agents/tools.ts (the write-side, agent-facing tool
// surface) — see docs/architecture/architecture.md for the read/write split.

export interface CommandCenterSummary {
  totalShipments: number;
  activeShipments: number;
  onTimeRate: number;
  activeExceptions: number;
  criticalExceptions: number;
  autonomousActions: number;
  pendingApprovals: number;
  seed: number;
  demoRunning: boolean;
  demoCompletedAt: string | null;
}

const AUTONOMOUS_LEVELS = new Set(["LOW_RISK_AUTONOMOUS", "OPERATIONAL_AUTONOMOUS"]);
const ACTIVE_EXCEPTION_STATUSES = new Set(["OPEN", "IN_PROGRESS", "ESCALATED"]);
const ACTIVE_SHIPMENT_STATUSES = new Set(["IN_TRANSIT", "SCHEDULED", "EXCEPTION", "AT_FACILITY"]);

export function getSummary(): CommandCenterSummary {
  const state = getState();
  const shipments = Array.from(state.shipments.values());
  const active = shipments.filter((s) => ACTIVE_SHIPMENT_STATUSES.has(s.status));
  const onTime = shipments.filter((s) => new Date(s.currentEta).getTime() <= new Date(s.deliveryWindowEnd).getTime());
  const exceptions = Array.from(state.exceptions.values());
  const activeExceptions = exceptions.filter((e) => ACTIVE_EXCEPTION_STATUSES.has(e.status));
  const runs = Array.from(state.agentRuns.values());
  const autonomousActions = runs.filter(
    (r) => r.status === "COMPLETED" && r.autonomyLevel && AUTONOMOUS_LEVELS.has(r.autonomyLevel)
  ).length;
  const pendingApprovals = Array.from(state.approvals.values()).filter((a) => a.status === "PENDING").length;

  return {
    totalShipments: shipments.length,
    activeShipments: active.length,
    onTimeRate: shipments.length ? onTime.length / shipments.length : 1,
    activeExceptions: activeExceptions.length,
    criticalExceptions: activeExceptions.filter((e) => e.severity === "CRITICAL").length,
    autonomousActions,
    pendingApprovals,
    seed: state.seed,
    demoRunning: state.demoRunning,
    demoCompletedAt: state.demoCompletedAt,
  };
}

export function listShipments(): Shipment[] {
  return Array.from(getState().shipments.values()).sort((a, b) => a.id.localeCompare(b.id));
}

export function listFacilities(): Facility[] {
  return Array.from(getState().facilities.values());
}

export function listDrivers(): Driver[] {
  return Array.from(getState().drivers.values());
}

export interface ShipmentDetail {
  shipment: Shipment;
  driver: Driver | null;
  vehicle: Vehicle | null;
  route: Route | null;
  originFacility: Facility | null;
  destinationFacility: Facility | null;
  exceptions: OperationalException[];
  agentRuns: (AgentRun & { steps: AgentStep[]; actions: AgentAction[] })[];
  communications: Communication[];
  auditEvents: AuditEvent[];
}

export function getShipmentDetail(id: string): ShipmentDetail | null {
  const state = getState();
  const shipment = state.shipments.get(id);
  if (!shipment) return null;
  const exceptions = Array.from(state.exceptions.values())
    .filter((e) => e.shipmentId === id)
    .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
  const agentRuns = Array.from(state.agentRuns.values())
    .filter((r) => r.shipmentId === id)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map((r) => ({
      ...r,
      steps: state.agentSteps.filter((s) => s.agentRunId === r.id).sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
      actions: state.agentActions.filter((a) => a.agentRunId === r.id),
    }));
  const communications = state.communications
    .filter((c) => c.shipmentId === id)
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  const auditEvents = state.auditLog
    .filter((a) => a.entityId === id || agentRuns.some((r) => r.id === a.agentRunId))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return {
    shipment,
    driver: shipment.driverId ? state.drivers.get(shipment.driverId) ?? null : null,
    vehicle: shipment.vehicleId ? state.vehicles.get(shipment.vehicleId) ?? null : null,
    route: shipment.routeId ? state.routes.get(shipment.routeId) ?? null : null,
    originFacility: state.facilities.get(shipment.originFacilityId) ?? null,
    destinationFacility: state.facilities.get(shipment.destinationFacilityId) ?? null,
    exceptions,
    agentRuns,
    communications,
    auditEvents,
  };
}

export function listExceptions(): (OperationalException & { shipment: Shipment | null; latestRun: AgentRun | null })[] {
  const state = getState();
  return Array.from(state.exceptions.values())
    .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt))
    .map((e) => ({
      ...e,
      shipment: state.shipments.get(e.shipmentId) ?? null,
      latestRun: e.agentRunId ? state.agentRuns.get(e.agentRunId) ?? null : null,
    }));
}

export function listApprovals(): (Approval & { run: AgentRun | null })[] {
  const state = getState();
  return Array.from(state.approvals.values())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((a) => ({ ...a, run: state.agentRuns.get(a.agentRunId) ?? null }));
}

export function listPolicies(): Policy[] {
  return Array.from(getState().policies.values());
}

export interface TimelineEntry {
  step: AgentStep;
  run: AgentRun;
}

export function listAgentActivity(limit = 200): TimelineEntry[] {
  const state = getState();
  const entries: TimelineEntry[] = state.agentSteps
    .map((step) => {
      const run = state.agentRuns.get(step.agentRunId);
      return run ? { step, run } : null;
    })
    .filter((e): e is TimelineEntry => e !== null)
    .sort((a, b) => b.step.timestamp.localeCompare(a.step.timestamp));
  return entries.slice(0, limit);
}

export function listAgentRuns(): AgentRun[] {
  return Array.from(getState().agentRuns.values()).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function listAuditLog(limit = 300): AuditEvent[] {
  return [...getState().auditLog].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);
}
