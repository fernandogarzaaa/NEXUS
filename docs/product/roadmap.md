# NEXUS Roadmap

## KPIs (tracked from Phase 1 onward)

| KPI | Definition | Why it's the metric (not "AI accuracy") |
|---|---|---|
| Exception Resolution Time | Time from detection to `RESOLVED`/`ESCALATED` | Direct measure of operational speed |
| Autonomous Resolution Rate | % of exceptions resolved without human approval | Tracks how much real work autonomy is doing, not just how often the model runs |
| On-Time Delivery Rate | % of shipments delivered within their window | The outcome the business actually sells on |
| Human Intervention Rate | % of agent runs requiring approval or escalation | Should trend down per action type as trust/thresholds are tuned — a governance metric, not a "failure" metric |
| Agent Action Success Rate | % of executed tool calls that verify successfully on first attempt | Engineering reliability signal, tied to retry/escalation design |
| Cost Avoided | Estimated cost of manual intervention avoided per autonomous resolution | Ties the product to dollars, not vibes |
| SLA Recovery Rate | % of window-violating exceptions brought back within window (or contractually acceptable recovery) | The real "did we save the delivery" number |

We deliberately do not lead with a generic "AI accuracy" metric: the
product is judged on operational outcomes the reasoning engine produces,
not on a proxy for how often the model "sounds right."

---

## Phase 1 — POC (this repository)

**Goal:** Prove the full Observe → Understand → Decide → Act → Verify →
Update → Escalate loop works, end to end, for exception recovery, with
governed autonomy and a full audit trail.

- Deterministic simulation engine, seeded demo dataset.
- Exception Recovery Agent (hero), Dynamic Dispatch Agent, Communication
  Agent.
- Typed tool layer, policy engine, approval workflow.
- Command Center, Exception Queue, Shipment Detail, Agent Activity,
  Approvals, Policy Config UI.
- Automated test coverage of agent behavior, system state changes, and the
  hero demo.

**Milestones:** vertical slice (delay → resolution) working → three agents
wired in → full UI → test suite green → docs + deck.
**Dependencies:** none (self-contained, in-memory).
**Risks:** none carried forward — POC is intentionally isolated.
**Success measure:** hero demo runs deterministically in <2 minutes;
evaluator can run it unassisted from the README.

## Phase 2 — Production MVP

**Goal:** Move from a seeded demo dataset to a real (single-tenant)
operator's live data, with dispatch automation and real communication
workflows.

- Persistent datastore (Postgres) replacing the in-memory store — see
  `docs/architecture/data-model.md` for the planned schema translation.
- Real outbound communications (email/SMS) behind the existing
  `Communication` event model — the simulation boundary was designed for
  exactly this swap.
- Dynamic Dispatch Agent promoted from on-demand sweep to a continuous
  background evaluator.
- Basic auth and single-tenant operator onboarding.
- Human-reviewable policy defaults tuned from Phase 1 dispatcher feedback.

**Milestones:** design partner onboarded → data model migrated → live
pilot on a subset of lanes → communications going to real
customers/facilities.
**Dependencies:** a committed design-partner carrier; Postgres
infrastructure.
**Risks:** real-world data is messier than seeded data (missing
appointment windows, inconsistent driver HOS reporting) — mitigate by
keeping the policy default conservative (more approval-gated) until data
quality is proven.
**Success measure:** Autonomous Resolution Rate ≥ 30% on pilot lanes
without a regression in On-Time Delivery Rate.

## Phase 3 — Integrations

**Goal:** Replace every simulated data source with a real one.

- TMS integration (read shipment/appointment state, write status back).
- Telematics integration (real driver location/HOS, replacing simulated
  delay events with real ones).
- Maps/routing API (real ETA and route recalculation, replacing the
  distance-based approximation).
- Carrier/EDI systems for real appointment rescheduling and outside
  carrier booking.
- Messaging providers (Twilio/SendGrid-class) for real notifications.

**Milestones:** one integration live at a time, each behind the same tool
interface the simulator already implements (`getShipment`,
`calculateRoute`, etc.), so agent logic does not change — only the tool
implementations do.
**Dependencies:** partner API access/credentials; data-quality validation
per integration.
**Risks:** integration reliability becomes the new failure surface — the
retry/escalation design from Phase 1 is what absorbs this, not new agent
logic.
**Success measure:** zero agent-logic changes required to swap a
simulated tool for a real one (the interface contract holds).

## Phase 4 — Network Intelligence

**Goal:** Move from reactive recovery to anticipation.

- Predictive disruption detection (flag a shipment as at-risk before it
  actually violates its window).
- Capacity forecasting across facilities and driver pools.
- Demand intelligence to inform proactive dispatch decisions.
- Network-level optimization (not just single-shipment recovery).

**Milestones:** predictive model in shadow mode → validated against
actuals → promoted to actively influence Dynamic Dispatch Agent
recommendations.
**Dependencies:** sufficient historical data volume from Phase 2–3
operation.
**Risks:** predictive false positives erode trust faster than reactive
misses — ship in observe/recommend autonomy tiers first.
**Success measure:** measurable reduction in exceptions that reach
CRITICAL severity (caught upstream instead).

## Phase 5 — Autonomous Operations

**Goal:** Increase the share of operational decisions executed without
human intervention, while keeping governance configurable and auditable
end to end.

- Expand default autonomy tiers as Agent Action Success Rate and
  Autonomous Resolution Rate data justify it, per action type.
- Cross-shipment, cross-driver optimization decisions (not just
  single-exception recovery).
- Operator-facing policy analytics ("here's what would change if you
  raised this threshold").

**Milestones:** per-action-type autonomy graduation criteria defined and
met → expanded autonomy shipped behind the same policy engine, no
architecture change.
**Dependencies:** sustained trust built over Phases 2–4; no unresolved
governance/compliance blockers.
**Risks:** over-rotating on autonomy without the audit/approval
infrastructure keeping pace — mitigated because that infrastructure is
foundational from Phase 1, not bolted on later.
**Success measure:** Human Intervention Rate trending down without a
corresponding rise in Agent Action Success Rate failures or SLA misses.
