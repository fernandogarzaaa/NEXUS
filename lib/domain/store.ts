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

// A single in-process operational store for the POC. This intentionally
// avoids a real database (see docs/architecture/data-model.md "Production
// evolution") — the POC's determinism and demo-reset requirements are
// better served by a reproducible in-memory snapshot than by external
// state. `globalThis` caching keeps a single instance across Next.js
// dev-mode module reloads.

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

function buildState(seed: number = DEMO_SEED): NexusState {
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

declare global {
  var __NEXUS_STATE__: NexusState | undefined;
}

export function getState(): NexusState {
  if (!globalThis.__NEXUS_STATE__) {
    globalThis.__NEXUS_STATE__ = buildState();
  }
  return globalThis.__NEXUS_STATE__;
}

export function resetState(seed: number = DEMO_SEED): NexusState {
  globalThis.__NEXUS_STATE__ = buildState(seed);
  return globalThis.__NEXUS_STATE__;
}

let idCounter = 0;
export function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
