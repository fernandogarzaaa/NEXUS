# Architecture

## Stack and why

- **Next.js 16 (App Router) + TypeScript**, single application. Server
  Components read directly from the in-memory store; Server Actions
  (`lib/actions.ts`) are the only mutation surface the UI calls. This
  avoids building and maintaining a separate REST API for a POC while
  keeping the same strict typing end to end.
- **Zod** for runtime validation of every tool call input (see
  `lib/agents/tools.ts`). TypeScript alone only checks compile-time
  shapes; the tool layer needs to also reject bad *runtime* input, most
  importantly whatever an LLM might eventually generate.
- **In-memory store** (`lib/domain/store.ts`) instead of a database. This
  is a deliberate POC-scoped choice, not an oversight — see "Why not a
  database yet" below and `docs/architecture/data-model.md` for the
  production path.
- **Vitest** for the test suite — fast, TypeScript-native, no additional
  config burden for a project this size.
- No external map/routing/LLM API is required to run or demo the
  product. An LLM integration is optional and additive (see
  `agent-design.md`).

## Layers

```
app/                        Next.js routes (Server Components + Server Actions as the only write path)
components/                 Presentational + thin client components (buttons, forms, badges)
lib/
  domain/
    types.ts                  Operational + agent-execution types
    seed.ts                   Deterministic seeded data generator
    state.ts                  NexusState working set, buildState, snapshot (de)serialisation
    repository.ts             StateRepository interface + in-memory implementation (default)
    store.ts                  Facade: getState/resetState/loadState/persistState over the active repository
  agents/
    tools.ts                 Typed, zod-validated tool layer — the ONLY way state is mutated
    policyEngine.ts           Autonomy policy evaluation
    reasoner.ts                Deterministic recovery-option generation + scoring
    llm.ts                      Optional LLM narration (never decision-critical)
    orchestrator.ts            Exception Recovery Agent's pipeline (Event -> ... -> Audit -> Communication)
    exceptionRecoveryAgent.ts   Detection entry point for delay-driven exceptions
    dynamicDispatchAgent.ts     Standing assignment-validity agent
    communicationAgent.ts       Owns all simulated outbound communication
  sim/
    simulator.ts                Deterministic disruption event generators
    heroDemo.ts                  The scripted, reproducible hero scenario
  queries.ts                  Read-side selectors shaping store state for the UI
  actions.ts                  Server Actions (the UI's only write path)
tests/                       Vitest suite (agent behavior, system state, hero e2e)
```

## The StateRepository seam

The POC's requirements — a reproducible seeded dataset, a one-click reset,
a deterministic hero scenario — are served by an in-memory working set
(`NexusState`, `lib/domain/state.ts`). Since 0.3.0 that working set is
owned by a `StateRepository` (`lib/domain/repository.ts`):

```
interface StateRepository {
  backend: "memory" | "postgres";
  getState(): NexusState;            // the synchronous working set tools mutate in place
  resetState(seed?): NexusState;     // rebuild deterministically from the seed
  load(): Promise<NexusState>;       // hydrate from durable storage (no-op in memory)
  persist(): Promise<void>;          // flush to durable storage (no-op in memory)
}
```

`lib/domain/store.ts` is a thin facade over the active repository, so
`lib/agents/tools.ts`, `lib/queries.ts` and the agents keep calling
`getState()` exactly as before. The in-memory implementation is the
default and is behaviourally identical to the original single-object
store; nothing outside `lib/domain` holds a direct reference to the
underlying `Map`s. A durable backend implements the same interface and is
selected by configuration, not by code changes in the agents, the policy
engine or the UI.

## The read/write split

- **`lib/queries.ts`** (read side): shapes store state for the UI. Never
  mutates.
- **`lib/agents/tools.ts`** (write side): the only place operational state
  is mutated, and the only surface an agent (or, later, an LLM) is allowed
  to call to effect a change. Every write tool validates its input with
  zod and writes an `AuditEvent`.

This split is what makes "LLMs must not directly mutate operational
state" true by construction, not by convention: there is no code path
from a model response to a `Map.set()` that skips validation and
audit-logging.

## Replacing the simulator with real integrations

`lib/sim/simulator.ts` produces `SimulationEvent`s
(`DRIVER_DELAYED`, `VEHICLE_UNAVAILABLE`, `TRAFFIC_INCREASE`,
`APPOINTMENT_UNAVAILABLE`, `SHIPMENT_PRIORITY_CHANGED`,
`CUSTOMER_REQUEST`) and calls the same detection entry points
(`detectDelayException`, etc.) that a real telematics/TMS webhook would
call. Swapping the simulator for a real integration means replacing the
event *source*, not the event *handling* — the same is true for
`calculateRoute`/`findAlternativeDriver` in `lib/agents/tools.ts`, which
are the seam for a real routing API.

## Rendering strategy

Every route is `export const dynamic = "force-dynamic"`. The store is
live, per-process, mutable state — Next.js's default static optimization
would otherwise cache a page render from build/first-request time and
serve it indefinitely, which is exactly wrong for a live operations
dashboard. Server Actions call `revalidatePath("/", "layout")` after every
mutation so the next render (or the client's periodic `router.refresh()`
poll, see `components/AutoRefresh.tsx`) reflects current state.

## Failure handling

See `docs/architecture/agent-design.md` "Failure handling" for the
retry/escalation design; it lives in `lib/agents/orchestrator.ts`'s
`handleExecutionFailure`.
