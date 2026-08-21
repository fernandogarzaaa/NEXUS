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

No `.env` file is required for the default (offline) experience.

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

40 tests across 8 files covering: exception detection and severity,
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
lib/domain/              Types, seeded data generator, in-memory store, policies
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

- **In-memory store, not a database.** The POC's requirements — a
  reproducible seeded dataset, instant reset, deterministic demo — are
  better served by an in-memory snapshot than by database seed/reset
  tooling. The production translation path is documented and
  intentionally a contained swap: see
  [`docs/architecture/data-model.md`](docs/architecture/data-model.md).
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
- The in-memory store is single-process and resets on restart; see the
  data model doc for the Postgres migration path.
- All communications are simulated (no real email/SMS/EDI); see the
  roadmap for the Phase 2/3 integration path.

## Roadmap

Phase 1 (this POC) → Phase 2 (production MVP: persistent store, real
communications, pilot operator) → Phase 3 (real TMS/telematics/routing/
carrier integrations) → Phase 4 (predictive/network intelligence) →
Phase 5 (expanded autonomous operations). Full detail, milestones, risks,
and per-phase success measures:
[`docs/product/roadmap.md`](docs/product/roadmap.md).
