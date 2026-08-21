import { beforeEach, describe, expect, it } from "vitest";
import { resetState } from "@/lib/domain/store";
import {
  calculateETA,
  getShipment,
  recordAgentAction,
  rescheduleAppointment,
  ToolExecutionError,
  ToolValidationError,
} from "@/lib/agents/tools";
import { HERO_SHIPMENT_ID } from "@/lib/domain/seed";

describe("typed tool layer", () => {
  beforeEach(() => resetState());

  it("rejects malformed tool input before it can touch state", () => {
    // @ts-expect-error intentionally malformed to exercise runtime validation
    expect(() => calculateETA({ shipmentId: HERO_SHIPMENT_ID, delayMin: "forty-five" })).toThrow(
      ToolValidationError
    );
  });

  it("rejects a call missing a required field", () => {
    // @ts-expect-error intentionally missing delayMin
    expect(() => calculateETA({ shipmentId: HERO_SHIPMENT_ID })).toThrow(ToolValidationError);
  });

  it("throws a typed execution error for an unknown shipment id", () => {
    expect(() => getShipment("SHP-DOES-NOT-EXIST")).toThrow(ToolExecutionError);
  });

  it("refuses to reschedule an appointment that does not exist", () => {
    const shipment = getShipment(HERO_SHIPMENT_ID);
    shipment.appointment = null;
    expect(() =>
      rescheduleAppointment({
        shipmentId: HERO_SHIPMENT_ID,
        newStart: new Date().toISOString(),
        newEnd: new Date().toISOString(),
        agentRunId: "RUN-TEST",
      })
    ).toThrow(ToolExecutionError);
  });

  it("is idempotent: replaying the same recorded action does not duplicate it", () => {
    const before = recordAgentAction({
      agentRunId: "RUN-TEST",
      tool: "testTool",
      input: { a: 1 },
      output: { ok: true },
      status: "SUCCESS",
    });
    const replay = recordAgentAction({
      agentRunId: "RUN-TEST",
      tool: "testTool",
      input: { a: 1 },
      output: { ok: true },
      status: "SUCCESS",
    });
    expect(replay.id).toBe(before.id);
  });
});
