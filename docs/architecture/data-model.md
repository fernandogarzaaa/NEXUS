# Data Model

All types are defined in `lib/domain/types.ts`. The model is deliberately
split into **operational state** and **agent execution state**, per the
spec — they represent different things (the world vs. what the agents did
about it) and are read/written by different code paths.

## Operational state

| Entity | Purpose |
|---|---|
| `Shipment` | The core operational record — origin/destination, driver/vehicle/route assignment, priority, delivery window, scheduled vs. current ETA, appointment |
| `Driver` | Status, location, hours-of-service remaining, on-time rating, assignments |
| `Vehicle` | Type, capacity, status |
| `Facility` | Warehouse/DC/customer site, operating hours, per-hour appointment capacity |
| `Route` | Distance, base duration, traffic factor, waypoints |
| `OperationalException` | A detected disruption: type, severity, ETA impact, status, resolution |

## Agent execution state

| Entity | Purpose |
|---|---|
| `AgentRun` | One agent invocation in response to a trigger event — type, status, plan, selected action, autonomy level, outcome |
| `AgentStep` | One phase-transition entry on a run's timeline (what the Agent Activity screen renders) |
| `AgentAction` | One executed tool call — tool name, input, output, status, idempotency key |
| `RecoveryPlan` / `RecoveryOption` | The reasoner's scored candidate set and selected choice for a run |
| `Policy` | Configured autonomy level + cost threshold per action type |
| `Approval` | A human-decision request — what/why/impact/cost/confidence, status |
| `Communication` | A simulated outbound message tied to a shipment and (optionally) the run that triggered it |
| `AuditEvent` | An immutable record of every state mutation — actor, action, entity, detail |

## Why the split matters

A `Shipment`'s current ETA is operational fact. An `AgentRun`'s confidence
score is a statement about the agent's own reasoning. Conflating them
would make it impossible to answer "what actually happened to this
shipment" independently of "what did the agent think/do" — which matters
both for the UI (Shipment Detail shows both, separately) and for a future
audit/compliance requirement that operational history outlive any given
agent implementation.

## Storage (POC vs. production)

The POC holds all of the above in `Map`s inside a single in-memory
`NexusState` object (`lib/domain/store.ts`), rebuilt deterministically from
a seeded generator (`lib/domain/seed.ts`) and reset on demand.

**Production translation** (Phase 2 of the roadmap): each `Map` becomes a
table in Postgres with the same shape; `id` fields are already
globally-unique strings suitable as primary keys; foreign keys
(`shipmentId`, `agentRunId`, etc.) already exist as plain string
references, so the relational structure requires no redesign — only a
repository layer implementing the same functions `lib/queries.ts` and
`lib/agents/tools.ts` call against `getState()` today.

## Determinism

`lib/domain/seed.ts` uses a seeded PRNG (`lib/domain/rng.ts`, mulberry32)
and a fixed epoch timestamp (`DEMO_EPOCH_MS`) so the entire dataset —
~63 shipments, 10 drivers, 5 facilities, 14 vehicles, one route per
shipment — is byte-for-byte reproducible for a given seed. One shipment
(`SHP-2000`, assigned to driver `D-07`) is deliberately hand-specified
rather than left to the random distribution, guaranteeing the hero demo's
delay always produces a genuine, reproducible delivery-window violation
with a feasible recovery — see `docs/demo/demo-script.md`.
