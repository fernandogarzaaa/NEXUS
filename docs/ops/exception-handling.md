# Exception handling in NEXUS

This runbook restates behaviour implemented in `lib/agents/` and the
default policy set in `lib/domain/policies.ts`. It is not a customer
document.

## Detection

A delay, vehicle failure, traffic increase or appointment conflict raises
an operational exception on the shipment. A delay that keeps the shipment
inside its delivery window at LOW severity is closed as within tolerance
and no recovery runs. Anything else marks the shipment EXCEPTION and
starts the Exception Recovery Agent.

## Recovery options

The deterministic reasoner scores five options: reschedule the destination
appointment, reassign to an available driver, adjust the route, book an
expedited outside carrier, or notify the customer only. The option that
recovers the most of the delay at acceptable cost, feasibility and risk is
selected. An LLM, if configured, only explains the choice.

## Policy and approval

Customer notifications and appointment reschedules up to 100 USD run
autonomously. Route adjustments up to 150 USD and carrier rebooking up to
500 USD run autonomously at the operational level. Driver reassignment
always requires human approval. Any option whose estimated cost exceeds its
policy threshold is escalated to the approval queue instead of executing.

## Failure and escalation

If execution fails or verification shows the revised ETA still misses the
window, the agent retries once with the next-best option. If that also
fails, the exception is escalated and the Ops Duty Manager is alerted. A
rejected approval escalates the exception and leaves the shipment for
manual handling. Under an OBSERVE policy the agent only reports and leaves
the exception open.
