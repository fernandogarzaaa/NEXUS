import { getState, nextId, nowIso } from "../domain/store";
import type { ExceptionSeverity, ExceptionType, OperationalException, Shipment } from "../domain/types";
import { calculateETA } from "./tools";
import { runExceptionRecoveryAgent } from "./orchestrator";

// ---------------------------------------------------------------------------
// Exception Recovery Agent — the hero agent. Detects operational exceptions
// (delays, ETA violations, missed windows, vehicle failures, appointment
// conflicts, route disruptions), then hands off to the orchestration
// pipeline (orchestrator.ts) for reasoning through execution.
// ---------------------------------------------------------------------------

function computeSeverity(minutesLate: number, priority: Shipment["priority"]): ExceptionSeverity {
  const weight = priority === "CRITICAL" ? 2 : priority === "HIGH" ? 1.4 : 1;
  const adjusted = minutesLate * weight;
  if (adjusted <= 0) return "LOW";
  if (adjusted < 15) return "LOW";
  if (adjusted < 40) return "MEDIUM";
  if (adjusted < 90) return "HIGH";
  return "CRITICAL";
}

/**
 * Detects a delay-driven exception on a shipment and immediately triggers
 * the recovery pipeline. Returns both the created exception and the
 * resulting agent run.
 */
export async function detectDelayException(
  shipmentId: string,
  delayMin: number,
  type: ExceptionType = "DRIVER_DELAYED",
  descriptionOverride?: string
) {
  const state = getState();
  const shipment = state.shipments.get(shipmentId);
  if (!shipment) throw new Error(`Unknown shipment ${shipmentId}`);

  const eta = calculateETA({ shipmentId, delayMin });
  shipment.currentEta = eta.newEta;
  shipment.updatedAt = nowIso();

  const severity = computeSeverity(Math.max(eta.minutesLate, 0), shipment.priority);
  const exception: OperationalException = {
    id: nextId("EXC"),
    shipmentId,
    type,
    severity,
    description:
      descriptionOverride ??
      `${type === "DRIVER_DELAYED" ? "Driver delayed" : type.replace(/_/g, " ")} by ${delayMin} min — revised ETA ${eta.newEta} ${
        eta.violatesWindow ? `misses the delivery window by ${eta.minutesLate} min` : "still within window"
      }.`,
    etaImpactMin: delayMin,
    detectedAt: nowIso(),
    status: "OPEN",
    resolutionSummary: null,
    agentRunId: null,
    resolvedAt: null,
  };
  state.exceptions.set(exception.id, exception);

  state.auditLog.push({
    id: nextId("AUD"),
    timestamp: nowIso(),
    actorType: "SYSTEM",
    actorId: "SIMULATION_ENGINE",
    action: "EXCEPTION_DETECTED",
    entityType: "OperationalException",
    entityId: exception.id,
    agentRunId: null,
    detail: exception.description,
  });

  // Only trigger the recovery pipeline for exceptions that actually miss
  // the delivery window or otherwise require operational attention. A
  // trivial, in-tolerance delay never touched the shipment's operational
  // status, so it's left exactly as it was found.
  if (!eta.violatesWindow && severity === "LOW") {
    exception.status = "RESOLVED";
    exception.resolutionSummary = "Within tolerance — no recovery action required.";
    exception.resolvedAt = nowIso();
    return { exception, run: null };
  }

  shipment.status = "EXCEPTION";
  const run = await runExceptionRecoveryAgent(exception.id);
  return { exception, run };
}
