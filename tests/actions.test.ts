import { beforeEach, describe, expect, it, vi } from "vitest";
import { getState, resetState } from "@/lib/domain/store";
import { HERO_DRIVER_ID, HERO_SHIPMENT_ID } from "@/lib/domain/seed";
import { evaluateDispatchAssignment } from "@/lib/agents/dynamicDispatchAgent";
import { decideApprovalAction } from "@/lib/actions";

// revalidatePath needs a live Next.js request context, which doesn't exist
// under vitest — the Server Action itself is what's under test here, not
// Next's cache invalidation, so stub it out.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("decideApprovalAction", () => {
  beforeEach(() => resetState());

  it("is idempotent: deciding the same approval twice only resolves it once", async () => {
    const state = getState();
    state.drivers.get(HERO_DRIVER_ID)!.status = "DELAYED";
    const { run } = evaluateDispatchAssignment(HERO_SHIPMENT_ID);
    expect(run!.status).toBe("AWAITING_APPROVAL");
    const approval = Array.from(state.approvals.values()).find((a) => a.agentRunId === run!.id)!;
    expect(approval).toBeDefined();

    await decideApprovalAction(approval.id, true, "First Click");
    const shipmentDriverAfterFirst = state.shipments.get(HERO_SHIPMENT_ID)!.driverId;
    expect(shipmentDriverAfterFirst).not.toBe(HERO_DRIVER_ID);
    expect(approval.resolvedBy).toBe("First Click");
    const runAfterFirst = state.agentRuns.get(run!.id)!;
    expect(runAfterFirst.status).toBe("COMPLETED");

    // Regression: a second decision on the same (already-resolved) approval
    // — e.g. a double-click, browser retry, or a stale approval page —
    // used to re-run the resume path: re-executing the tool call a second
    // time, or (for dispatch) flipping an already-completed run to
    // ESCALATED because pendingDispatchProposals had already been cleared.
    await decideApprovalAction(approval.id, false, "Stale Second Click");

    expect(approval.resolvedBy).toBe("First Click"); // unchanged
    expect(approval.status).toBe("APPROVED"); // unchanged
    expect(state.agentRuns.get(run!.id)!.status).toBe("COMPLETED"); // not flipped to ESCALATED
    expect(state.shipments.get(HERO_SHIPMENT_ID)!.driverId).toBe(shipmentDriverAfterFirst);
  });
});
