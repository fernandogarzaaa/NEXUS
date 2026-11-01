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

## Storage

All of the above lives in one in-process working set, `NexusState`
(`lib/domain/state.ts`): a `Map` per keyed entity plus append-only arrays
for steps, actions, communications and the audit log. The working set is
built deterministically from the seeded generator (`lib/domain/seed.ts`)
and reset on demand.

Ownership of that object is a `StateRepository` (`lib/domain/repository.ts`).
The repository decides where the working set comes from and where it goes:

- `InMemoryStateRepository` (default): the working set is the storage.
  `load()`/`persist()` are no-ops. This is the POC behaviour, unchanged.
- `PostgresStateRepository` (`NEXUS_STATE_BACKEND=postgres`): `load()`
  hydrates the working set from one table per entity and `persist()`
  flushes it after a mutation boundary. Each table stores the canonical
  record as `jsonb` in `data`, plus columns **generated from** `data`
  (status, foreign keys, timestamps) for SQL reporting and indexes, and an
  `ord` column so Map insertion order survives the round trip. The schema
  is `db/migrations/0001_init.sql`; `id` fields were already
  globally-unique strings, so they are the primary keys as-is and
  `policies` is keyed by `action_type` like the in-memory Map.

`serializeState`/`deserializeState` (`lib/domain/state.ts`) are the
canonical plain-JSON projection of the working set; every backend and the
repository tests use them, so a snapshot that round-trips there round-trips
anywhere.

## Units, currency and time

Quantities are metric (`weightKg`, `capacityKg`, `distanceKm`). Money fields
carry no currency in their names (`estimatedCost`, `maxCost`): amounts are in
the deployment currency, `NEXUS_CURRENCY` (default AUD). Stored timestamps are
ISO-8601 UTC; facility operating hours and appointment slots are local to
`NEXUS_TIMEZONE` (default Australia/Sydney), and the UI shows local time.
`db/migrations/0002_metric_units_neutral_currency.sql` converts databases
written before 0.4.0 (units converted, money values kept as they were).

## Determinism

`lib/domain/seed.ts` uses a seeded PRNG (`lib/domain/rng.ts`, mulberry32)
and a fixed epoch timestamp (`DEMO_EPOCH_MS`) so the entire dataset —
~63 shipments, 10 drivers, 5 facilities, 14 vehicles, one route per
shipment — is byte-for-byte reproducible for a given seed. One shipment
(`SHP-2000`, assigned to driver `D-07`) is deliberately hand-specified
rather than left to the random distribution, guaranteeing the hero demo's
delay always produces a genuine, reproducible delivery-window violation
with a feasible recovery — see `docs/demo/demo-script.md`.
