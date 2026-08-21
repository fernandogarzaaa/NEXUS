# Demo Script (~2 minutes)

Run `npm run dev`, open `http://localhost:3000`. The app boots with a
fresh, seeded dataset — 63 shipments, 10 drivers, 5 Texas facilities, 14
vehicles — and zero agent activity yet.

## 1. Orient on the Command Center (15s)

Point out: total/active shipments, on-time rate, exception counters,
autonomous-action counter, pending approvals — all zero/100% at rest. The
route map shows the live shipment network across Dallas, Fort Worth,
Austin, Houston, and San Antonio.

## 2. Run the hero scenario (5s to click, ~1s to execute)

Click **▶ Run Demo Scenario**. This fires the deterministic scenario:
**driver D-07 is delayed 45 minutes** on shipment `SHP-2000` (Metroplex
Electronics, CRITICAL priority, en route Dallas → Austin).

## 3. Watch it happen (30s)

The Command Center's KPIs and "Recent Agent Activity" panel update
immediately (poll every 5s, or click a nav link to force a refresh). Open
**Agent Activity** for the full, timestamped, phase-by-phase record:

```
Exception detected           DETECT     driver delayed 45 min, revised ETA misses the window
Shipment context retrieved   CONTEXT    SHP-2000, CRITICAL, driver D-07, destination FAC-AUS
Evaluating recovery options  REASON     scoring feasible options
Recovery option selected     PLAN       reschedule appointment — confidence ~90%+
Autonomy level: ...          POLICY     $25 estimated cost, under the $100 threshold — autonomous
Executing ...                EXECUTE    reschedule appointment
[Communication Agent]        EXECUTE    Facility contacted
[Communication Agent]        EXECUTE    Facility confirmed
Outcome verified             VERIFY     revised ETA now within the delivery window
Shipment state updated       UPDATE     current ETA updated, status back to IN_TRANSIT
[Communication Agent]        NOTIFY     Customer notified
Audit trail recorded         AUDIT      full record in the audit log
```

This is two agents' work on one timeline: the Exception Recovery Agent
drove the decision; the Communication Agent handled the facility handshake
and customer notification as part of the same run.

## 4. Show the exception, resolved (15s)

**Exception Queue** — one row: `SHP-2000`, `DRIVER DELAYED`, severity
`HIGH`, recommendation `RESCHEDULE APPOINTMENT`, autonomy `LOW RISK
AUTONOMOUS`, status `RESOLVED`, approval `COMPLETED`. No human touched
this — it resolved autonomously because the policy threshold allowed it.

## 5. Show the full record on the shipment (15s)

Click into `SHP-2000`. **Shipment Detail** shows the exception, the full
agent run with every step, the communication history (facility + customer
messages), and the audit history — everything traceable to one decision.

## 6. Show governed autonomy in action (20s)

Go to **Command Center** and click **Run Dispatch Sweep**. Because D-07 is
now marked `DELAYED`, the Dynamic Dispatch Agent flags every *other* active
shipment assigned to D-07 as at-risk and proposes reassigning them — but
driver reassignment is always policy-gated to human approval, regardless
of cost. Open **Approvals**: each pending item shows what will happen, why,
expected impact, cost, and confidence. Click **Approve** on one — it
executes immediately, updates the shipment's driver of record, and moves
to "Resolved" with who approved it and when. Click **Reject** on another to
show the escalation path: it alerts the ops duty manager instead of
executing.

## 7. Show the governance surface (10s)

Open **Policy Configuration**. Change "Appointment reschedule"'s threshold
or autonomy level and save — this takes effect on the next exception
immediately. This is the control an operations manager needs to see before
trusting the system with anything.

## Resetting

**Reset Demo** on the Command Center restores the fresh seeded state
(same seed, same dataset) so the scenario can be re-run identically.

## What this demonstrates against the assignment brief

- **Observe → Understand → Decide → Act → Verify → Update → Escalate**,
  completed for real, not simulated as a chat response.
- **Three differentiated agentic functions**, visibly cooperating on one
  timeline.
- **Governed autonomy**, visibly configurable, with both the autonomous
  and approval-gated paths shown in one pass.
- **A full audit trail**, from detection to resolution.
