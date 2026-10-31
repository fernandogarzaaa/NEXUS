# NEXUS — AI-First Agentic Logistics Platform

NEXUS is a proof-of-concept for an autonomous logistics operations layer.
It continuously monitors shipments, understands operational disruptions,
determines the best recovery action, executes permitted actions through a
controlled tool layer, verifies the outcome, and escalates to a human when
it should. Built as an AI Agent Engineer case study — see
[`docs/`](docs) for the full product and architecture writeup, and
[`docs/demo/demo-script.md`](docs/demo/demo-script.md) for a guided
2-minute walkthrough.

## Problem → Solution

Small and mid-sized carriers/3PLs get plenty of *visibility* tools that
tell them a shipment is late. None of them answer "what should happen
next, and can the system make it happen?" — that's still a dispatcher on
the phone, every time, for every exception. NEXUS closes that loop: it
detects the exception, reasons about recovery options, checks what it's
allowed to do, does it (or asks a human), verifies the result, and leaves
an audit trail. See [`docs/product/PRD.md`](docs/product/PRD.md) for the
full problem statement and target user.

## The three agents

1. **Exception Recovery Agent** (hero) — detects delays/ETA
   violations/vehicle failures/appointment conflicts, generates and scores
   recovery options, executes within policy or escalates for approval,
   verifies the outcome, retries or escalates on failure.
2. **Dynamic Dispatch Agent** — continuously validates whether the current
   driver/vehicle assignment for each active shipment still holds up
   (hours-of-service, availability), proposing reassignment — always
   gated to human approval.
3. **Communication & Coordination Agent** — owns every simulated outbound
   message resulting from another agent's decision: customer ETA updates,
   facility appointment handshakes, driver instructions, ops escalation
   alerts.

Full design: [`docs/architecture/agent-design.md`](docs/architecture/agent-design.md).

## Architecture at a glance

```
Event -> Context Retrieval -> Agent Reasoning -> Plan -> Policy Evaluation
     -> Human Approval (if required) -> Tool Execution -> Verification
     -> State Update -> Audit Event -> Communication
```

Agents never touch state directly — every mutation goes through a typed,
zod-validated tool layer (`lib/agents/tools.ts`) that also writes an audit
event. Autonomy is configured per action type (Observe / Recommend /
Low-risk autonomous / Operational autonomous / High-impact approval),
editable at runtime from the Policy Configuration screen. Full details:
[`docs/architecture/architecture.md`](docs/architecture/architecture.md).

No external API is required to run or demo NEXUS. An `ANTHROPIC_API_KEY`
is optional — if set, it enriches the recovery rationale's natural-language
explanation; the decision logic itself is always deterministic (required
for the reproducible hero demo) and falls back to a templated rationale
if no key is set.

## Setup

Requires Node 20+.

```bash
npm install
```

### Environment variables (all optional)

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | If set, enriches recovery rationale text via Claude. Omit to run fully offline. |
| `ANTHROPIC_MODEL` | Overrides the model used for narration (default `claude-sonnet-5`). |
| `NEXUS_ACCESS_TOKEN` | Shared access token. When set, every page and Server Action requires signing in at `/login` with this token (12 h `HttpOnly`, `SameSite=Lax` session cookie). |
| `NEXUS_ALLOW_UNAUTHENTICATED` | Set to `1` to run a public throwaway demo without a token. Without a token and without this flag, production builds refuse all state-changing actions (approve/reject, reset, run scenario, policy edits); `next dev` and tests stay open. |
| `NEXUS_STATE_BACKEND` | `memory` (default: in-process, resets on restart) or `postgres` (durable). See "State backend" below. |
| `DATABASE_URL` | Postgres connection string. Required when `NEXUS_STATE_BACKEND=postgres`. |
| `DATABASE_SSL` | Set to `1` for TLS with certificate verification against the system trust store. |
| `NEXUS_TEST_DATABASE_URL` | A throwaway database the Postgres integration tests may wipe. Unset: those tests are skipped. |
| `NEXUS_API_KEYS` | JSON array of scoped API keys for the read API (`/api/v1`). Unset: the API answers 503. See [`docs/architecture/api.md`](docs/architecture/api.md). |
| `NEXUS_OPS_DOCS_DIR` | Directory of ops documents for retrieval (default `docs/ops`). |
| `NEXUS_RAG_MAX_AGE_HOURS` | Optional: retrieval refuses records whose own timestamp is older than this. |
| `NEXUS_TENANT_ID` | Tenant this deployment serves (default `demo`); API keys for another tenant are refused. |

No `.env` file is required for the default (offline) experience in `next dev`.

**Deploying publicly:** set `NEXUS_ACCESS_TOKEN` (or explicitly opt out with
`NEXUS_ALLOW_UNAUTHENTICATED=1`). The gate is enforced twice: in `proxy.ts`
(Next.js 16's replacement for `middleware.ts`) and inside every Server Action.

### State backend

By default NEXUS keeps its working set in memory, rebuilt from the
deterministic seed on every start. To keep state across restarts and get a
real SQL surface, point it at Postgres:

```bash
export NEXUS_STATE_BACKEND=postgres
export DATABASE_URL=postgres://user:pass@host:5432/nexus
npm run db:migrate          # applies db/migrations/*.sql (forward-only, idempotent)
npm run db:seed             # loads the same demo set the memory backend starts with
npm run db:seed -- --force  # replaces whatever is there with the demo set
```

An empty, migrated database is seeded automatically on the app's first
request, so `db:seed` is only needed to reset or to pre-load. The schema
stores every canonical record as `jsonb` with generated, indexed columns
for ids, statuses and foreign keys (see `db/migrations/0001_init.sql`).
Agents, tools and queries are unchanged between backends: they all run
against one in-process working set that a `StateRepository`
(`lib/domain/repository.ts`) hydrates before each request and flushes after
each Server Action. This supports one NEXUS server process per database;
multi-instance coordination is not built.

### External adapters and reconciliation (proof of the seam)

`lib/adapters/` reads an external system **read-only** (CSV extract or a
GET-only REST endpoint), maps rows to the canonical `Shipment` / `Driver` /
`Vehicle` / `Facility` types through a declarative mapping file, and
reconciles them against the canonical store:

```bash
npm run reconcile -- --mapping adapters/generic/mapping.json [--entity shipment] [--out report.json]
```

The report lists matched records (with field-level differences), source
records NEXUS does not know, canonical records the source did not present,
duplicate source ids, rows that map to the same canonical id, and
quarantined rows with the exact missing fields and errors. Nothing is
written to the source or the store. `adapters/generic/` is a generic
example built from the demo seed with deliberate anomalies because no
real system name was supplied; see its README for how to point it at a
real export.

### Public read API

`/api/v1/*` exposes shipments, drivers, vehicles, facilities, exceptions,
approvals, policies, agent runs, the audit log and the command-center
summary as JSON, read-only, behind scoped API keys (`Authorization:
Bearer <keyId>.<secret>`). Every request with a recognised key is written
to the audit log. Routes are backed by `lib/queries.ts` and the tool layer,
never by direct store access. Full route table, scopes and key format:
[`docs/architecture/api.md`](docs/architecture/api.md).

### Knowledge retrieval (RAG)

`GET /api/v1/ask?q=…` answers from canonical records and the ops documents
in `docs/ops/`. Every sentence of an answer is a retrieved passage with a
numbered citation naming the source record and its timestamp. Unknown ids,
unrelated questions, and sources that changed or disappeared since
indexing return `NOT_FOUND` instead of a guess. Deterministic BM25, no
LLM, no external service. Details:
[`docs/architecture/knowledge.md`](docs/architecture/knowledge.md).

### Legacy migration harness (dry run only)

```bash
npm run migrate:dry-run -- --mapping adapters/generic/mapping.json [--entity shipment] [--out report.json] [--snapshot-dir ./snapshots]
```

Takes a read-only snapshot of the source through the adapter layer (with a
SHA-256 of what was read and an optional local copy), maps every row to
the canonical types, and reports counts, duplicates (by source id and by
canonical id, identical vs conflicting), missing fields per row and in
aggregate, dangling references, quarantined rows with reasons, and what a
real migration would create, update or leave unchanged. There is no
non-dry-run mode: the harness never writes to the source or to NEXUS, and
never merges duplicates. Details: [`docs/architecture/migration.md`](docs/architecture/migration.md).

## Running the application

```bash
npm run dev
```

Open `http://localhost:3000`. The app boots with a deterministic seeded
dataset (63 shipments, 10 drivers, 5 facilities, 14 vehicles across five
Texas metros).

- **Command Center** — fleet KPIs, route map, recent agent activity.
- **Exception Queue** — every detected exception and its recovery status.
- **Shipments** — the full shipment list; click into any shipment for its
  full detail (route, agent runs, communications, audit history).
- **Agent Activity** — the full cross-agent timeline.
- **Approvals** — pending and resolved human-in-the-loop decisions.
- **Policy Config** — autonomy levels and cost thresholds, editable live.

## Running the demo

Click **▶ Run Demo Scenario** on the Command Center. This fires the
deterministic hero scenario (driver D-07 delayed 45 minutes on a
CRITICAL-priority shipment) and drives it end to end in under a second of
processing time — watch it unfold on the Agent Activity timeline. Full
script with expected output: [`docs/demo/demo-script.md`](docs/demo/demo-script.md).

Other controls on the Command Center:
- **Run Dispatch Sweep** — triggers the Dynamic Dispatch Agent's standing
  assignment-validity check across all active shipments.
- **Simulate Random Event** — fires one random disruption event from the
  simulation engine, for open-ended exploration beyond the scripted demo.
- **Reset Demo** — restores the original seeded state.

## Running tests

```bash
npm test
```

100 tests across 17 files covering: the StateRepository seam and backend selection, the Postgres backend (migrations, seeding, lossless persist/reload, run against a real database in CI), the read-only adapter seam and reconciliation report, the scoped-key public API, the dry-run migration harness, the access-token gate (login, session cookie, proxy, every Server Action refusing without a session), policy input validation, exception detection and severity,
policy enforcement and threshold escalation, typed-tool input validation
and idempotency, the full orchestration pipeline (autonomous execution,
approval pause/resume, rejection/escalation, execution-failure retry),
the Dynamic Dispatch Agent's approval flow, the Communication Agent, the
simulation engine's event types, and an end-to-end test of the hero demo
scenario (including a reproducibility check across repeated runs).

## Project structure

```
app/                   Next.js routes (Server Components + Server Actions)
components/             UI components
lib/domain/              Types, seeded data generator, NexusState + StateRepository (memory / Postgres), policies
lib/db/                   Postgres pool, migration runner, seed loader
lib/adapters/             Read-only CSV/REST source adapters, mapping engine, reconciliation
lib/apiAuth.ts            Scoped API-key auth (pure) for the public read API
lib/api/handler.ts        Authenticated, audited, read-only route wrapper
app/api/v1/               Public read API routes
lib/migration/            Legacy migration harness (dry run only)
lib/knowledge/            Cited, verified retrieval over canonical records and ops docs
docs/ops/                  Ops documents indexed for retrieval
adapters/generic/          Example mapping + legacy-style CSV extracts (proof of the seam)
db/migrations/             Forward-only SQL migrations
scripts/                   db:migrate / db:seed entry points
lib/agents/               Tool layer, policy engine, reasoner, orchestrator, the three agents
lib/sim/                   Simulation engine + hero demo script
lib/queries.ts             Read-side selectors for the UI
lib/actions.ts             Server Actions (the UI's only write path)
tests/                   Vitest suite
docs/product/              PRD, competitive analysis, roadmap
docs/architecture/          Architecture, agent design, data model
docs/demo/                   Demo script
```

## Key architecture decisions (and why)

- **One in-process working set, pluggable persistence.** The POC's
  requirements — a reproducible seeded dataset, instant reset,
  deterministic demo — are served by an in-memory working set. A
  `StateRepository` owns that set: the in-memory implementation is the
  default, and the Postgres implementation hydrates and flushes the same
  set behind a flag, so no agent or tool code knows which backend is in
  use. See [`docs/architecture/data-model.md`](docs/architecture/data-model.md).
- **Deterministic decision logic, optional LLM narration.** The hero demo
  must be reproducible and the POC must not require network access. The
  reasoner's ranking is a deterministic scoring function; an LLM (if
  configured) only writes the human-readable explanation of an
  already-made decision — see
  [`docs/architecture/agent-design.md`](docs/architecture/agent-design.md).
- **A typed tool layer is the only mutation path.** This is what makes
  "agents cannot directly mutate operational state" structurally true,
  not just a convention — see `lib/agents/tools.ts`.
- **Read/write split** (`lib/queries.ts` vs. `lib/agents/tools.ts`). Keeps
  the UI's data-shaping logic separate from the agent-facing,
  audit-logged mutation surface.

## Limitations

- The route map is a lightweight SVG projection of seeded coordinates, not
  a real mapping/routing provider.
- ETA/routing math is distance-based, not a real routing graph —
  intentional; real routing integration is Phase 3 scope.
- The default in-memory backend is single-process and resets on restart.
  The Postgres backend is durable but still assumes a single NEXUS server
  process per database (no multi-writer coordination).
- All communications are simulated (no real email/SMS/EDI); see the
  roadmap for the Phase 2/3 integration path.

## Roadmap

Phase 1 (this POC) → Phase 2 (production MVP: persistent store, real
communications, pilot operator) → Phase 3 (real TMS/telematics/routing/
carrier integrations) → Phase 4 (predictive/network intelligence) →
Phase 5 (expanded autonomous operations). Full detail, milestones, risks,
and per-phase success measures:
[`docs/product/roadmap.md`](docs/product/roadmap.md).
