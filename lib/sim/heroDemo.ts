import { getState, nowIso } from "../domain/store";
import { HERO_DRIVER_ID, HERO_SHIPMENT_ID } from "../domain/seed";
import { simulateDriverDelayed } from "./simulator";

// ---------------------------------------------------------------------------
// The hero demo scenario (spec section 9): Driver D-07 is delayed 45 min on
// a time-critical shipment, which the Exception Recovery Agent detects,
// reasons about, clears through policy, executes (facility reschedule),
// verifies, and reports on — end to end, understandable in ~2 minutes.
// ---------------------------------------------------------------------------

export const HERO_DELAY_MIN = 45;

export async function runHeroDemo() {
  const state = getState();
  state.demoRunning = true;
  try {
    const shipment = state.shipments.get(HERO_SHIPMENT_ID);
    if (!shipment) throw new Error("Hero shipment not found — was the store reset with a custom seed?");

    const { event, exception, run } = await simulateDriverDelayed(HERO_SHIPMENT_ID, HERO_DELAY_MIN);

    state.demoRunning = false;
    state.demoCompletedAt = nowIso();

    return {
      driverId: HERO_DRIVER_ID,
      shipmentId: HERO_SHIPMENT_ID,
      delayMin: HERO_DELAY_MIN,
      event,
      exception,
      run,
      steps: run ? state.agentSteps.filter((s) => s.agentRunId === run.id) : [],
    };
  } catch (err) {
    state.demoRunning = false;
    throw err;
  }
}
