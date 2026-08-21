import { nextId } from "../domain/store";
import type { OperationalException, RecoveryOption, RecoveryPlan, Shipment } from "../domain/types";
import { calculateETA, calculateRoute, findAlternativeDriver, getFacility } from "./tools";
import { narrateRecoveryPlan } from "./llm";

// ---------------------------------------------------------------------------
// Deterministic recovery reasoning. This is the decision-critical path used
// by the Exception Recovery Agent: it always runs and always produces the
// same ranked options for the same inputs, which is what keeps the hero
// demo scenario reproducible. An optional LLM (see llm.ts) may enrich the
// human-readable rationale, but it never changes which option is selected —
// satisfying "LLMs must not directly mutate operational state" and keeping
// the deterministic hero demo deterministic even when a model key is set.
// ---------------------------------------------------------------------------

function scoreOption(opt: Omit<RecoveryOption, "score">, etaImpactMin: number): number {
  // Higher is better. The dominant term is how much of the ACTUAL problem
  // the option recovers (recoveryRatio), not the raw minutes recovered —
  // this is what keeps a genuine fix ranked above "just notify the
  // customer" regardless of how large or small the delay is. Feasibility,
  // cost, and risk break ties between options that recover comparably.
  // See docs/architecture/agent-design.md "Why NOTIFY_ONLY can't win by
  // default" for the reasoning behind these weights.
  const recoveryRatio = etaImpactMin > 0 ? Math.min(opt.etaImprovementMin / etaImpactMin, 1) : 1;
  const costTerm = 1 - Math.min(opt.estimatedCostUsd, 800) / 800; // 0..1
  return recoveryRatio * 0.55 + opt.feasibility * 0.2 + costTerm * 0.15 + (1 - opt.riskScore) * 0.1;
}

export async function evaluateRecoveryOptions(
  shipment: Shipment,
  exception: OperationalException
): Promise<RecoveryPlan> {
  const options: RecoveryOption[] = [];
  const etaImpactMin = exception.etaImpactMin;
  const finalize = (opt: Omit<RecoveryOption, "score">): RecoveryOption => ({
    ...opt,
    score: scoreOption(opt, etaImpactMin),
  });

  // Option 1: reschedule the destination appointment to absorb the delay.
  if (shipment.appointment) {
    const facility = getFacility(shipment.appointment.facilityId);
    const hourOfDelay = new Date(
      new Date(shipment.appointment.start).getTime() + etaImpactMin * 60_000
    ).getUTCHours();
    const slot = facility.appointmentCapacity.find((c) => c.hour === hourOfDelay);
    const hasCapacity = !slot || slot.booked < slot.capacity;
    options.push(
      finalize({
        id: nextId("OPT"),
        type: "RESCHEDULE_APPOINTMENT",
        description: `Move the ${facility.name} appointment later by ${etaImpactMin} min to match the revised ETA.`,
        estimatedCostUsd: 25,
        etaImprovementMin: etaImpactMin,
        feasibility: hasCapacity ? 0.95 : 0.35,
        riskScore: 0.1,
      })
    );
  }

  // Option 2: reassign to an alternative driver who can still make the window.
  const altDriver = findAlternativeDriver({ shipmentId: shipment.id });
  if (altDriver) {
    options.push(
      finalize({
        id: nextId("OPT"),
        type: "REASSIGN_DRIVER",
        description: `Reassign to ${altDriver.name} (available, ${altDriver.hoursOfServiceRemaining.toFixed(
          1
        )}h HOS remaining, ${(altDriver.onTimeRating * 100).toFixed(0)}% on-time rating).`,
        estimatedCostUsd: 180,
        etaImprovementMin: Math.round(etaImpactMin * 0.85),
        feasibility: 0.8,
        riskScore: 0.35,
      })
    );
  }

  // Option 3: adjust the route to recover time (alternate routing / reduced stops).
  const route = calculateRoute({ shipmentId: shipment.id });
  options.push(
    finalize({
      id: nextId("OPT"),
      type: "ADJUST_ROUTE",
      description: `Recompute routing for ${shipment.id} to offset traffic factor ${route.trafficFactor.toFixed(
        2
      )}x and recover transit time.`,
      estimatedCostUsd: 10,
      etaImprovementMin: Math.round(etaImpactMin * 0.35),
      feasibility: 0.7,
      riskScore: 0.15,
    })
  );

  // Option 4: expedite via outside carrier — always available, but costly.
  options.push(
    finalize({
      id: nextId("OPT"),
      type: "CARRIER_REBOOK",
      description: `Book an expedited outside carrier to guarantee the delivery window.`,
      estimatedCostUsd: 650,
      etaImprovementMin: etaImpactMin,
      feasibility: 0.9,
      riskScore: 0.2,
    })
  );

  // Option 5: fallback — notify only, no operational change.
  options.push(
    finalize({
      id: nextId("OPT"),
      type: "NOTIFY_ONLY",
      description: `Notify the customer of the revised ETA without changing operations.`,
      estimatedCostUsd: 0,
      etaImprovementMin: 0,
      feasibility: 1,
      riskScore: 0.05,
    })
  );

  const ranked = [...options].sort((a, b) => b.score - a.score);
  const selected = ranked[0];
  const confidence = Math.min(0.97, 0.6 + selected.score * 0.4);

  const rationale = await narrateRecoveryPlan({
    shipment,
    exception,
    selected,
    alternatives: ranked.slice(1),
  });

  return {
    shipmentId: shipment.id,
    exceptionId: exception.id,
    options: ranked,
    selectedOptionId: selected.id,
    confidence,
    rationale: rationale.text,
    generatedBy: rationale.source,
  };
}

export function computeExceptionFromDelay(shipment: Shipment, delayMin: number) {
  const eta = calculateETA({ shipmentId: shipment.id, delayMin });
  return eta;
}
