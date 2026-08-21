# Agent Design

## The orchestration pipeline

Every agent run passes through the same phase sequence, recorded as
`AgentStep`s so the Agent Activity timeline shows a structured record —
never raw model chain-of-thought:

```
Event -> Context Retrieval -> Agent Reasoning -> Plan -> Policy Evaluation
     -> Human Approval (if required) -> Tool Execution -> Verification
     -> State Update -> Audit Event -> Communication
```

Implemented primarily in `lib/agents/orchestrator.ts` for the Exception
Recovery Agent; the Dynamic Dispatch Agent (`dynamicDispatchAgent.ts`)
runs a lighter version of the same sequence for its narrower decision
(reassign or don't).

## The three agents

### 1. Exception Recovery Agent (hero) — `orchestrator.ts` + `exceptionRecoveryAgent.ts`

Detects delay/failure/conflict exceptions
(`lib/agents/exceptionRecoveryAgent.ts:detectDelayException`), computes
severity from ETA impact weighted by shipment priority, and — if the
exception actually threatens the delivery window — hands off to
`runExceptionRecoveryAgent`, which:

1. Retrieves shipment/driver/facility context.
2. Calls the reasoner (`reasoner.ts:evaluateRecoveryOptions`) to generate
   and score up to five recovery options.
3. Evaluates the top option against the policy engine.
4. Executes autonomously, or requests human approval and pauses
   (`AWAITING_APPROVAL`), resuming via
   `resumeExceptionRecoveryAfterApproval` once a human decides.
5. Verifies the outcome (does the revised ETA now fall inside the
   delivery window?).
6. On failure or failed verification, retries once with the next-best
   option before escalating (see "Failure handling" below).
7. Updates shipment state, notifies stakeholders via the Communication
   Agent, and resolves the exception with an audit trail.

### 2. Dynamic Dispatch Agent — `dynamicDispatchAgent.ts`

Independent of the delay-triggered flow above: this agent asks "is the
*current* assignment still valid?" for every active shipment — checking
hours-of-service remaining against the route's remaining distance, and
whether the driver is otherwise marked `DELAYED`. It's invoked on demand
via "Run Dispatch Sweep" in the POC (a continuous background sweep is
Phase 2 scope, see the roadmap); a real deployment would run it on a
timer or in response to HOS/telematics updates.

Driver reassignment is **always** policy-gated to human approval
(`POL-REASSIGN-DRIVER`, `HIGH_IMPACT_APPROVAL`) — reassigning a person's
workload is treated as inherently higher-stakes than rebooking an
appointment, independent of dollar cost.

### 3. Communication & Coordination Agent — `communicationAgent.ts`

Owns every simulated outbound message the system produces as a result of
another agent's decision: customer ETA updates, facility appointment
request/confirmation handshakes, driver reassignment instructions, and
internal ops escalation alerts. It writes its own `AgentStep`s onto the
*same* agent run it's supporting (prefixed `[Communication Agent]`) so the
Agent Activity timeline reads as one coherent cross-agent story — e.g. the
hero scenario's `Facility contacted` → `Facility confirmed` → `Shipment
updated` → `Customer notified` sequence is two agents' work interleaved on
one timeline, exactly as specified.

All communications are `simulated: true` `Communication` records — no
real email/SMS/EDI integration in the POC (see roadmap Phase 2/3).

## The typed tool layer

Agents never mutate state directly. `lib/agents/tools.ts` exposes:

- **Read tools:** `getShipment`, `getDriver`, `getVehicle`, `getFacility`,
  `calculateETA`, `calculateRoute`, `findAlternativeDriver`.
- **Write tools:** `rescheduleAppointment`, `reassignShipment`,
  `updateRoute`, `applyEtaImprovement`, `sendNotification`,
  `requestApproval`, `recordAgentAction`, `resolveException`,
  `escalateException`.

Every tool validates its input against a zod schema before touching
state (`ToolValidationError` on bad input) and every write tool appends an
`AuditEvent`. This is the enforcement point for "validate model-generated
tool calls before execution" — it holds whether the caller is the
deterministic reasoner (always, today) or a future LLM-driven planner
(architecturally ready, not yet load-bearing).

## Human oversight: the autonomy model

Five levels, configured per action type in `lib/domain/policies.ts` and
editable at runtime from the Policy Configuration screen:

| Level | Behavior |
|---|---|
| `OBSERVE` | Detect and report only; no action taken |
| `RECOMMEND` | Proposes an action; always requires approval |
| `LOW_RISK_AUTONOMOUS` | Executes automatically, optionally under a cost threshold |
| `OPERATIONAL_AUTONOMOUS` | Executes automatically within configured operational limits |
| `HIGH_IMPACT_APPROVAL` | Always requires human approval, regardless of cost |

Default policy set (`lib/domain/policies.ts`):

| Action | Default level | Threshold |
|---|---|---|
| Customer notification | Low-risk autonomous | — |
| Appointment reschedule | Low-risk autonomous | ≤ $100 |
| Route adjustment | Operational autonomous | ≤ $150 |
| Driver reassignment | High-impact approval | always |
| Carrier rebook / expedite | Operational autonomous | ≤ $500 |

`lib/agents/policyEngine.ts:evaluatePolicy` is the single decision point:
a policy's base level can still be escalated to `HIGH_IMPACT_APPROVAL` at
runtime if the estimated cost exceeds its configured threshold — this is
what implements "appointment rescheduling under $100 is autonomous, over
it needs approval" as one rule instead of two.

## Recovery option scoring — and why `NOTIFY_ONLY` can't win by default

The reasoner scores each option as:

```
score = recoveryRatio * 0.55 + feasibility * 0.20 + costTerm * 0.15 + (1 - riskScore) * 0.10
```

where `recoveryRatio = min(etaImprovementMin / etaImpactMin, 1)` — how
much of the *actual* problem the option fixes, not the raw minutes
recovered. An earlier version of this formula weighted absolute ETA
improvement against feasibility/cost/risk in a way that let `NOTIFY_ONLY`
(zero operational change, perfect feasibility/cost/risk) score
competitively against real recovery actions purely because it's "safe" —
i.e., the agent could default to just telling the customer instead of
fixing the problem, which directly contradicts the product's premise that
the agent should perform real operational work. Weighting recovery ratio
at 0.55 means an option that doesn't actually fix the problem cannot
outscore one that does, regardless of how cheap or safe it is. This was
caught by `tests/orchestrator.test.ts`'s failure/retry test during
development, not by inspection — see that file's comments for the worked
scoring example.

## Failure handling

`orchestrator.ts:handleExecutionFailure` implements:

```
Agent -> Detect failure -> Retry once with next-best scored option
      -> If that also fails/doesn't verify -> Escalate to human
      -> Record failure + escalation reason in the audit trail
      -> Communication Agent alerts the Ops Duty Manager
```

Failure is detected two ways: a tool call throwing (e.g.
`rescheduleAppointment` when the facility has no capacity at the proposed
hour) or verification failing (the revised ETA still exceeds the delivery
window after execution). Both paths are covered in
`tests/orchestrator.test.ts`. An exception is never left silently `OPEN`
after a run completes — it ends `RESOLVED` or `ESCALATED`, always.

## Optional LLM integration (`lib/agents/llm.ts`)

The recovery **decision** is always deterministic — this is required for
the hero demo's reproducibility and for not making the POC depend on
network access. If `ANTHROPIC_API_KEY` is set, the reasoner asks the model
to write a 2–3 sentence natural-language rationale for the *already
selected* option (given the selected option and rejected alternatives as
structured input); if the key is absent, the call fails, or it times out,
a templated rationale is used instead — silently and safely, with
`RecoveryPlan.generatedBy` recording which path was taken. The model is
never given tool-calling access and never in the state-mutation path,
consistent with "LLMs must not directly mutate operational state."
