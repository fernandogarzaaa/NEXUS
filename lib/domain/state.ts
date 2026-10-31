import { generateSeedData, DEMO_SEED } from "./seed";
import { defaultPolicies } from "./policies";
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
} from "./types";

// The in-process working set every agent, tool and query operates on.
// Mutations happen directly on these Maps/arrays (through lib/agents/tools.ts)
// and a StateRepository (lib/domain/repository.ts) is responsible for
// building, hydrating and persisting the whole set.

export interface NexusState {
  facilities: Map<string, Facility>;
  vehicles: Map<string, Vehicle>;
  drivers: Map<string, Driver>;
  shipments: Map<string, Shipment>;
  routes: Map<string, Route>;
  exceptions: Map<string, OperationalException>;
  policies: Map<string, Policy>;
  agentRuns: Map<string, AgentRun>;
  agentSteps: AgentStep[];
  agentActions: AgentAction[];
  communications: Communication[];
  approvals: Map<string, Approval>;
  auditLog: AuditEvent[];
  /** agentRunId -> proposed alternative driverId, for Dynamic Dispatch runs
   *  awaiting approval (see lib/agents/dynamicDispatchAgent.ts). */
  pendingDispatchProposals: Map<string, string>;
  seed: number;
  demoRunning: boolean;
  demoCompletedAt: string | null;
  seq: number;
}

/** Build a fresh working set from the deterministic seed generator. */
export function buildState(seed: number = DEMO_SEED): NexusState {
  const data = generateSeedData(seed);
  return {
    facilities: new Map(data.facilities.map((f) => [f.id, f])),
    vehicles: new Map(data.vehicles.map((v) => [v.id, v])),
    drivers: new Map(data.drivers.map((d) => [d.id, d])),
    shipments: new Map(data.shipments.map((s) => [s.id, s])),
    routes: new Map(data.routes.map((r) => [r.id, r])),
    exceptions: new Map(),
    policies: new Map(defaultPolicies().map((p) => [p.actionType, p])),
    agentRuns: new Map(),
    agentSteps: [],
    agentActions: [],
    communications: [],
    approvals: new Map(),
    auditLog: [],
    pendingDispatchProposals: new Map(),
    seed,
    demoRunning: false,
    demoCompletedAt: null,
    seq: 0,
  };
}

/**
 * A plain-JSON, order-stable projection of NexusState. This is the unit a
 * repository stores and loads; Maps become arrays so the shape survives
 * JSON.stringify and SQL round-trips without surprises.
 */
export interface StateSnapshot {
  facilities: Facility[];
  vehicles: Vehicle[];
  drivers: Driver[];
  shipments: Shipment[];
  routes: Route[];
  exceptions: OperationalException[];
  policies: Policy[];
  agentRuns: AgentRun[];
  agentSteps: AgentStep[];
  agentActions: AgentAction[];
  communications: Communication[];
  approvals: Approval[];
  auditLog: AuditEvent[];
  pendingDispatchProposals: Array<{ agentRunId: string; driverId: string }>;
  seed: number;
  demoRunning: boolean;
  demoCompletedAt: string | null;
  seq: number;
}

export function serializeState(state: NexusState): StateSnapshot {
  return {
    facilities: Array.from(state.facilities.values()),
    vehicles: Array.from(state.vehicles.values()),
    drivers: Array.from(state.drivers.values()),
    shipments: Array.from(state.shipments.values()),
    routes: Array.from(state.routes.values()),
    exceptions: Array.from(state.exceptions.values()),
    policies: Array.from(state.policies.values()),
    agentRuns: Array.from(state.agentRuns.values()),
    agentSteps: [...state.agentSteps],
    agentActions: [...state.agentActions],
    communications: [...state.communications],
    approvals: Array.from(state.approvals.values()),
    auditLog: [...state.auditLog],
    pendingDispatchProposals: Array.from(state.pendingDispatchProposals, ([agentRunId, driverId]) => ({
      agentRunId,
      driverId,
    })),
    seed: state.seed,
    demoRunning: state.demoRunning,
    demoCompletedAt: state.demoCompletedAt,
    seq: state.seq,
  };
}

export function deserializeState(snapshot: StateSnapshot): NexusState {
  return {
    facilities: new Map(snapshot.facilities.map((f) => [f.id, f])),
    vehicles: new Map(snapshot.vehicles.map((v) => [v.id, v])),
    drivers: new Map(snapshot.drivers.map((d) => [d.id, d])),
    shipments: new Map(snapshot.shipments.map((s) => [s.id, s])),
    routes: new Map(snapshot.routes.map((r) => [r.id, r])),
    exceptions: new Map(snapshot.exceptions.map((e) => [e.id, e])),
    policies: new Map(snapshot.policies.map((p) => [p.actionType, p])),
    agentRuns: new Map(snapshot.agentRuns.map((r) => [r.id, r])),
    agentSteps: [...snapshot.agentSteps],
    agentActions: [...snapshot.agentActions],
    communications: [...snapshot.communications],
    approvals: new Map(snapshot.approvals.map((a) => [a.id, a])),
    auditLog: [...snapshot.auditLog],
    pendingDispatchProposals: new Map(snapshot.pendingDispatchProposals.map((p) => [p.agentRunId, p.driverId])),
    seed: snapshot.seed,
    demoRunning: snapshot.demoRunning,
    demoCompletedAt: snapshot.demoCompletedAt,
    seq: snapshot.seq,
  };
}
