# Competitive Analysis

Agentic logistics is not a new category claim — visibility and TMS
incumbents are actively adding AI features. NEXUS's argument is about
**where the agent sits and what it's allowed to do**, not that automated
reasoning over shipments is a novel idea.

## Landscape

| Company | Core strength | What they do today | Where NEXUS differs |
|---|---|---|---|
| **project44** | Real-time multimodal visibility, predictive ETA, large carrier network | Surfaces disruptions and predicted ETAs to shippers/3PLs; "Movement" adds some workflow automation | project44 tells you what's happening and increasingly what's likely to happen; it is not built as an execution layer that reassigns a driver or rebooks a dock appointment on your behalf under your policy |
| **FourKites** | Visibility + "Dynamic ETA," yard/dock management modules | Similar visibility-first position; recent GenAI features summarize and explain disruptions | Explanation and summarization, not policy-gated autonomous action; still assumes a human executes the fix |
| **Manhattan Associates (TMS/WMS)** | System-of-record planning and optimization at enterprise scale | Strong at planned optimization (load building, route planning) and warehouse execution | Built around planning cycles and enterprise scale/cost; not designed as a live, continuously-running exception-response agent for a 20–200 load/day operator |
| **Locus** | Last-mile route optimization and dispatch | Optimizes routes and dispatch decisions, often at large-fleet scale | Optimization-first, not exception-recovery-first; NEXUS is scoped specifically around "something just went wrong, what now" rather than "what's the optimal plan" |
| **Project-level GenAI copilots** (various 2024–2026 entrants) | Chat interfaces over TMS data | Let a dispatcher ask questions about shipments in natural language | A chatbot is not an operations layer — it still requires a human to read the answer and go execute it manually in another system |

## Where NEXUS is genuinely different

1. **Execution, not just explanation.** The recovery pipeline ends in a
   typed tool call that mutates real operational state (a rebooked
   appointment, a reassigned driver), not a chat message a human has to
   act on.
2. **Governed autonomy as a first-class product surface.** Autonomy is
   configured per action type with cost thresholds, visible and editable
   in the product itself — not a hidden model parameter. This is the
   feature that lets a skeptical ops manager say yes to turning it on.
3. **Sized for the underserved middle.** Enterprise TMS/visibility
   platforms are built and priced for large shippers and 3PLs. A 60-truck
   regional carrier is generally choosing between "no software" and
   "over-built enterprise software." NEXUS targets that gap specifically.
4. **Full audit trail by construction.** Every autonomous action is
   traceable to a policy decision and a recorded rationale — a
   requirement large platforms bolt on, that NEXUS's architecture makes
   structurally unavoidable (agents cannot mutate state outside the typed,
   audited tool layer).

## What NEXUS deliberately does not attempt (POC scope)

- Competing on network size or carrier connectivity (project44/FourKites'
  actual moat).
- Competing on enterprise-scale load optimization (Manhattan/Locus's
  strength).
- Real-time GPS/telematics ingestion — the POC's simulator is the seam
  where that integration attaches (`docs/architecture/architecture.md`).
- Multi-modal freight (ocean/air/rail) — road-only for the initial target
  user.

## Why the target customer would care

A regional carrier or 3PL evaluating project44 or FourKites still has to
staff the response to whatever those tools surface. NEXUS's pitch is not
"better visibility" — it's "fewer 2am phone calls, because half of them
already got handled and the other half are the ones that actually needed
a human, with everything already prepared for that human's decision."
