import { beforeEach, describe, expect, it } from "vitest";
import { getState, resetState } from "@/lib/domain/store";
import { HERO_SHIPMENT_ID } from "@/lib/domain/seed";
import {
  simulateAppointmentUnavailable,
  simulateCustomerRequest,
  simulateShipmentPriorityChanged,
  simulateTrafficIncrease,
  simulateVehicleUnavailable,
} from "@/lib/sim/simulator";
import { SeededRandom } from "@/lib/domain/rng";

describe("simulation engine", () => {
  beforeEach(() => resetState());

  it("VEHICLE_UNAVAILABLE marks the vehicle in maintenance and raises a delay exception", async () => {
    const state = getState();
    const shipment = state.shipments.get(HERO_SHIPMENT_ID)!;
    const { exception } = await simulateVehicleUnavailable(HERO_SHIPMENT_ID, new SeededRandom(7));
    expect(state.vehicles.get(shipment.vehicleId!)?.status).toBe("MAINTENANCE");
    expect(exception.type).toBe("VEHICLE_FAILURE");
  });

  it("TRAFFIC_INCREASE raises the route's traffic factor and logs a route-disruption exception", async () => {
    const state = getState();
    const shipment = state.shipments.get(HERO_SHIPMENT_ID)!;
    const before = state.routes.get(shipment.routeId!)!.trafficFactor;
    const { exception } = await simulateTrafficIncrease(HERO_SHIPMENT_ID, new SeededRandom(3));
    const after = state.routes.get(shipment.routeId!)!.trafficFactor;
    expect(after).toBeGreaterThan(before);
    expect(exception.type).toBe("ROUTE_DISRUPTION");
  });

  it("APPOINTMENT_UNAVAILABLE saturates the original slot and raises an appointment-conflict exception", async () => {
    const { exception } = await simulateAppointmentUnavailable(HERO_SHIPMENT_ID);
    expect(exception.type).toBe("APPOINTMENT_CONFLICT");
  });

  it("SHIPMENT_PRIORITY_CHANGED updates the shipment and logs an audit event without needing an agent run", () => {
    const state = getState();
    simulateShipmentPriorityChanged(HERO_SHIPMENT_ID, "HIGH");
    expect(state.shipments.get(HERO_SHIPMENT_ID)?.priority).toBe("HIGH");
    expect(state.auditLog.some((a) => a.action === "SIM_EVENT_SHIPMENT_PRIORITY_CHANGED")).toBe(true);
  });

  it("CUSTOMER_REQUEST logs an inbound communication for ops to see", () => {
    const state = getState();
    simulateCustomerRequest(HERO_SHIPMENT_ID, "Can you confirm delivery today?");
    const comm = state.communications.find((c) => c.body === "Can you confirm delivery today?");
    expect(comm).toBeDefined();
    expect(comm!.channel).toBe("CUSTOMER");
  });
});
