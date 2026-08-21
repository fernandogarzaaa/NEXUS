import { beforeEach, describe, expect, it } from "vitest";
import { resetState } from "@/lib/domain/store";
import { runHeroDemo, HERO_DELAY_MIN } from "@/lib/sim/heroDemo";
import { HERO_SHIPMENT_ID, HERO_DRIVER_ID } from "@/lib/domain/seed";

describe("hero demo scenario (end-to-end)", () => {
  beforeEach(() => {
    resetState();
  });

  it("runs the full observe->act->verify->audit pipeline deterministically", async () => {
    const result = await runHeroDemo();

    expect(result.driverId).toBe(HERO_DRIVER_ID);
    expect(result.shipmentId).toBe(HERO_SHIPMENT_ID);
    expect(result.delayMin).toBe(HERO_DELAY_MIN);

    // Exception was detected and, because it violates the delivery window,
    // triggered the recovery pipeline.
    expect(result.exception.type).toBe("DRIVER_DELAYED");
    expect(result.run).not.toBeNull();

    const run = result.run!;
    expect(["COMPLETED", "AWAITING_APPROVAL", "ESCALATED"]).toContain(run.status);

    // The full phase sequence should be observable in the timeline.
    const phases = result.steps.map((s) => s.phase);
    expect(phases).toContain("DETECT");
    expect(phases).toContain("CONTEXT");
    expect(phases).toContain("REASON");
    expect(phases).toContain("PLAN");
    expect(phases).toContain("POLICY");

    // Appointment reschedule is cheap ($25) and under the $100 autonomous
    // threshold, so this specific scenario should resolve autonomously.
    expect(run.status).toBe("COMPLETED");
    expect(phases).toContain("EXECUTE");
    expect(phases).toContain("VERIFY");
    expect(phases).toContain("UPDATE");
    expect(phases).toContain("NOTIFY");
    expect(phases).toContain("AUDIT");
  });

  it("is reproducible across repeated runs against a fresh seed", async () => {
    resetState();
    const first = await runHeroDemo();
    resetState();
    const second = await runHeroDemo();

    expect(first.run?.status).toBe(second.run?.status);
    expect(first.run?.selectedActionType).toBe(second.run?.selectedActionType);
    expect(first.exception.severity).toBe(second.exception.severity);
    expect(first.exception.etaImpactMin).toBe(second.exception.etaImpactMin);
  });
});
