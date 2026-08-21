# NEXUS — Product Requirements Document

## 1. Problem

Small and mid-sized logistics operators — regional carriers and asset-light
3PLs running roughly 20–200 active loads a day — run their networks on a
mix of a TMS, a whiteboard, and group chats. Visibility products
(project44, FourKites) tell them a shipment is late. They do not tell them
what to do about it, and they never do it for them. The result: every
exception — a delayed driver, a blown appointment window, a truck that
breaks down — becomes a manual scramble. A dispatcher has to notice it, get
context, call three people, and re-key the outcome into three systems, all
under time pressure, dozens of times a day.

At this size of operator, there is no dedicated "exception desk." The same
2–4 dispatchers who are booking tomorrow's loads are also firefighting
today's. Headcount doesn't scale with shipment volume, so exception
response time scales with how busy the day already is — worst exactly when
it matters most.

**The problem is not lack of visibility. It's lack of coordinated,
authorized action.** The question these operators need answered is not
"what is happening?" — it's **"what should happen next, and can the system
make it happen?"**

## 2. Target user

**Primary persona: Dana, Operations Manager at a 60-truck regional
carrier.**

- Owns on-time performance and customer satisfaction for ~80 active
  shipments a day.
- Splits her day between dispatch, customer calls, and firefighting.
- Currently uses a TMS for the shipment record, a separate routing tool,
  phone/text for driver and facility coordination, and spreadsheets for
  anything the TMS doesn't model well.
- Is not going to trust a black box with money-moving or customer-facing
  decisions on day one — she wants to see the AI's reasoning and be able to
  turn its permissions up or down action by action.

**Secondary persona: Marcus, a driver**, and **facility dock coordinators**
at the 3–5 DCs/warehouses this carrier serves regularly — both are on the
receiving end of NEXUS's coordination, not its operators, but their
experience (do they get a clear instruction? a confirmed appointment?)
determines whether the automation actually reduces friction or just moves
it around.

### Existing alternatives and why they fall short

| Alternative | What it does | Where it stops |
|---|---|---|
| project44 / FourKites | Real-time visibility, predictive ETA | Reports the problem; no action |
| Manhattan Associates (TMS/WMS) | System of record, planning, optimization | Batch/planning-oriented, not built for live exception response |
| Locus | Route optimization, dispatch | Optimizes the plan, doesn't manage the plan breaking in real time |
| Phone + spreadsheet (status quo) | Total flexibility | Doesn't scale, no audit trail, entirely dependent on tribal knowledge |

### Unmet need

An operations layer that sits on top of (not instead of) the TMS, watches
for the same disruptions a dispatcher would, and — within limits the
operator controls — actually resolves them: rebooks the appointment,
notifies the customer, reassigns the driver, and only interrupts a human
when the decision genuinely needs one.

## 3. Product thesis

> NEXUS is an autonomous logistics operations layer that continuously
> monitors shipments, understands operational disruptions, determines the
> best recovery action, executes permitted actions through controlled
> tools, verifies the outcome, and escalates to humans when necessary.

The product is judged on **Observe → Understand → Decide → Act → Verify →
Update → Escalate**, completed end to end, not on the quality of a
recommendation a human still has to execute.

## 4. Business impact

- **Time-to-resolution** on exceptions drops from "whenever a dispatcher
  gets to it" (today: often 20–60+ minutes) to seconds for autonomous
  tiers and single-digit minutes for approval-gated tiers.
- **Dispatcher capacity** is freed from repetitive coordination
  (appointment rebooking, status notifications) to focus on judgment calls
  the policy engine correctly routes to them.
- **On-time performance and SLA recovery** improve because exceptions are
  caught and acted on at machine speed instead of at "whenever someone
  notices."
- **Auditability** — every autonomous action is logged with rationale,
  which matters both for customer disputes and for building the trust
  needed to raise the autonomy ceiling over time.

## 5. Functional requirements (POC scope)

1. Detect operational exceptions from a live shipment/driver/facility
   dataset: delays, ETA/window violations, vehicle failures, appointment
   conflicts, route disruptions.
2. For each exception, retrieve context, generate and score multiple
   recovery options, and select one with a stated rationale and
   confidence.
3. Evaluate the selected action against a configurable autonomy policy;
   execute directly if permitted, or route to a human Approval Queue with
   full context (what, why, impact, cost, confidence) if not.
4. Execute recovery actions through a typed, validated tool layer only —
   never through unconstrained model output.
5. Verify the outcome (does the shipment now fall within its delivery
   window?) and retry with the next-best option, or escalate to a human,
   if it doesn't.
6. Record every state change as a structured audit event.
7. Simulate all customer/facility/driver communications resulting from a
   decision, visible per-shipment and system-wide.
8. Continuously re-validate driver/vehicle assignment validity
   (independent of the exception flow) and propose reassignments.
9. Expose a Command Center, Exception Queue, Shipment Detail, Agent
   Activity timeline, Approval Queue, and Policy Configuration screen.
10. Run a deterministic, reproducible hero demo scenario end to end.

## 6. Non-functional requirements

- **Determinism for the demo path.** The hero scenario must produce the
  same decision every run — evaluated in `tests/heroDemo.test.ts`.
- **No mandatory external dependency.** The POC must run fully offline; an
  LLM key is optional narrative enrichment only (see
  `docs/architecture/agent-design.md`).
- **No silent failure.** Every execution failure either retries safely or
  escalates to a human — never left as an unresolved, unreported state.
- **No chain-of-thought exposure.** The Agent Activity timeline shows
  structured phase/label/detail entries, never raw model reasoning.

## 7. Out of scope for the POC

- Real carrier/TMS/telematics/routing integrations (the simulator is a
  seam for these — see `docs/architecture/architecture.md`).
- Real outbound communications (email/SMS/EDI) — all communications are
  simulated and recorded as `Communication` events.
- Multi-tenant auth, billing, and org/role management.
- Mobile driver app.

## 8. KPIs

See `docs/product/roadmap.md` for phased targets. Primary metrics:
Exception Resolution Time, Autonomous Resolution Rate, On-Time Delivery
Rate, Human Intervention Rate, Agent Action Success Rate, Cost Avoided,
SLA Recovery Rate.

## 9. Limitations (honest, as implemented)

- The "map" is a lightweight SVG projection of seeded facility coordinates,
  not a real mapping/routing provider.
- ETA and routing math are simplified (distance-based, not a true routing
  graph) — intentionally, since the assignment scopes real routing
  integration as future work.
- The in-memory store is single-process and resets on server restart; see
  `docs/architecture/data-model.md` for the production database path.
- Only three simulated disruption types drive the hero flow in depth
  (`DRIVER_DELAYED` primarily); the other simulator events exist and are
  tested but are intentionally lighter-weight.
