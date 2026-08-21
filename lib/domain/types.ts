// Core operational data model for NEXUS.
// Kept as plain TypeScript types (no ORM) so the POC has zero external
// database dependency; see docs/architecture/data-model.md for the
// production evolution path (Postgres + Prisma).

export type ISODateString = string;

export type ShipmentStatus =
  | "SCHEDULED"
  | "IN_TRANSIT"
  | "AT_FACILITY"
  | "EXCEPTION"
  | "DELIVERED"
  | "CANCELLED";

export type ShipmentPriority = "STANDARD" | "HIGH" | "CRITICAL";

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface AppointmentSlot {
  facilityId: string;
  start: ISODateString;
  end: ISODateString;
  status: "SCHEDULED" | "CONFIRMED" | "MISSED" | "RESCHEDULED";
}

export interface Shipment {
  id: string;
  referenceCode: string;
  customerName: string;
  originFacilityId: string;
  destinationFacilityId: string;
  driverId: string | null;
  vehicleId: string | null;
  routeId: string | null;
  status: ShipmentStatus;
  priority: ShipmentPriority;
  weightLbs: number;
  distanceMiles: number;
  deliveryWindowStart: ISODateString;
  deliveryWindowEnd: ISODateString;
  scheduledEta: ISODateString;
  currentEta: ISODateString;
  appointment: AppointmentSlot | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type DriverStatus = "AVAILABLE" | "ON_ROUTE" | "DELAYED" | "OFF_DUTY";

export interface Driver {
  id: string;
  name: string;
  homeFacilityId: string;
  status: DriverStatus;
  location: GeoPoint;
  assignedShipmentIds: string[];
  hoursOfServiceRemaining: number;
  onTimeRating: number; // 0-1
  vehicleId: string | null;
}

export type VehicleType = "DRY_VAN" | "REEFER" | "FLATBED" | "BOX_TRUCK";
export type VehicleStatus = "AVAILABLE" | "IN_USE" | "MAINTENANCE";

export interface Vehicle {
  id: string;
  type: VehicleType;
  capacityLbs: number;
  status: VehicleStatus;
  currentDriverId: string | null;
}

export type FacilityType = "WAREHOUSE" | "DISTRIBUTION_CENTER" | "CUSTOMER_SITE";

export interface FacilityAppointmentCapacity {
  hour: number; // 0-23 local slot start
  capacity: number;
  booked: number;
}

export interface Facility {
  id: string;
  name: string;
  type: FacilityType;
  city: string;
  state: string;
  location: GeoPoint;
  operatingHoursStart: number;
  operatingHoursEnd: number;
  appointmentCapacity: FacilityAppointmentCapacity[];
}

export interface RouteWaypoint extends GeoPoint {
  label?: string;
}

export interface Route {
  id: string;
  shipmentId: string;
  originFacilityId: string;
  destinationFacilityId: string;
  distanceMiles: number;
  baseDurationMin: number;
  trafficFactor: number; // multiplier, 1.0 = normal
  waypoints: RouteWaypoint[];
}

export type ExceptionType =
  | "DRIVER_DELAYED"
  | "ETA_VIOLATION"
  | "MISSED_WINDOW"
  | "VEHICLE_FAILURE"
  | "APPOINTMENT_CONFLICT"
  | "ROUTE_DISRUPTION";

export type ExceptionSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type ExceptionStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "ESCALATED";

export interface OperationalException {
  id: string;
  shipmentId: string;
  type: ExceptionType;
  severity: ExceptionSeverity;
  description: string;
  etaImpactMin: number;
  detectedAt: ISODateString;
  status: ExceptionStatus;
  resolutionSummary: string | null;
  agentRunId: string | null;
  resolvedAt: ISODateString | null;
}

// ---------------------------------------------------------------------------
// Agent execution state (kept separate from operational state per spec)
// ---------------------------------------------------------------------------

export type AgentType =
  | "EXCEPTION_RECOVERY"
  | "DYNAMIC_DISPATCH"
  | "COMMUNICATION";

export type AgentRunStatus =
  | "RUNNING"
  | "COMPLETED"
  | "AWAITING_APPROVAL"
  | "ESCALATED"
  | "FAILED";

export type AgentPhase =
  | "DETECT"
  | "CONTEXT"
  | "REASON"
  | "PLAN"
  | "POLICY"
  | "APPROVAL"
  | "EXECUTE"
  | "VERIFY"
  | "UPDATE"
  | "AUDIT"
  | "NOTIFY"
  | "ESCALATE";

export interface AgentStep {
  id: string;
  agentRunId: string;
  timestamp: ISODateString;
  phase: AgentPhase;
  label: string;
  detail: string;
  status: "OK" | "WARN" | "ERROR";
}

export type RecoveryOptionType =
  | "RESCHEDULE_APPOINTMENT"
  | "REASSIGN_DRIVER"
  | "ADJUST_ROUTE"
  | "EXPEDITE"
  | "CARRIER_REBOOK"
  | "NOTIFY_ONLY";

export interface RecoveryOption {
  id: string;
  type: RecoveryOptionType;
  description: string;
  estimatedCostUsd: number;
  etaImprovementMin: number;
  feasibility: number; // 0-1
  riskScore: number; // 0-1, lower is safer
  score: number; // composite ranking score, higher is better
}

export interface RecoveryPlan {
  shipmentId: string;
  exceptionId: string;
  options: RecoveryOption[];
  selectedOptionId: string;
  confidence: number; // 0-1
  rationale: string;
  generatedBy: "DETERMINISTIC_REASONER" | "LLM_REASONER";
}

export type AutonomyLevel =
  | "OBSERVE"
  | "RECOMMEND"
  | "LOW_RISK_AUTONOMOUS"
  | "OPERATIONAL_AUTONOMOUS"
  | "HIGH_IMPACT_APPROVAL";

export interface Policy {
  id: string;
  actionType: string;
  label: string;
  description: string;
  autonomyLevel: AutonomyLevel;
  maxCostUsd: number | null;
  editable: boolean;
}

export interface AgentAction {
  id: string;
  agentRunId: string;
  tool: string;
  input: unknown;
  output: unknown;
  status: "SUCCESS" | "FAILED" | "RETRIED";
  attempt: number;
  idempotencyKey: string;
  timestamp: ISODateString;
}

export interface AgentRun {
  id: string;
  agentType: AgentType;
  triggerEventType: string;
  shipmentId: string | null;
  exceptionId: string | null;
  startedAt: ISODateString;
  completedAt: ISODateString | null;
  status: AgentRunStatus;
  plan: RecoveryPlan | null;
  selectedActionType: string | null;
  autonomyLevel: AutonomyLevel | null;
  outcomeSummary: string | null;
}

export type CommunicationChannel = "CUSTOMER" | "FACILITY" | "DRIVER" | "INTERNAL";

export interface Communication {
  id: string;
  shipmentId: string;
  agentRunId: string | null;
  channel: CommunicationChannel;
  recipient: string;
  subject: string;
  body: string;
  sentAt: ISODateString;
  simulated: true;
}

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface Approval {
  id: string;
  agentRunId: string;
  shipmentId: string;
  actionType: string;
  summary: string;
  whatWillHappen: string;
  why: string;
  expectedImpact: string;
  estimatedCostUsd: number;
  slaImpactMin: number;
  confidence: number;
  contextNotes: string[];
  status: ApprovalStatus;
  createdAt: ISODateString;
  resolvedAt: ISODateString | null;
  resolvedBy: string | null;
}

export type AuditActorType = "AGENT" | "HUMAN" | "SYSTEM";

export interface AuditEvent {
  id: string;
  timestamp: ISODateString;
  actorType: AuditActorType;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  agentRunId: string | null;
  detail: string;
}

// ---------------------------------------------------------------------------
// Simulation events
// ---------------------------------------------------------------------------

export type SimulationEventType =
  | "DRIVER_DELAYED"
  | "VEHICLE_UNAVAILABLE"
  | "TRAFFIC_INCREASE"
  | "APPOINTMENT_UNAVAILABLE"
  | "SHIPMENT_PRIORITY_CHANGED"
  | "CUSTOMER_REQUEST";

export interface SimulationEvent {
  id: string;
  type: SimulationEventType;
  shipmentId: string;
  driverId: string | null;
  payload: Record<string, unknown>;
  occurredAt: ISODateString;
}
