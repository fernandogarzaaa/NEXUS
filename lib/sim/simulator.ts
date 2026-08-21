import { SeededRandom } from "../domain/rng";
import { getState, nextId, nowIso } from "../domain/store";
import type { SimulationEvent, SimulationEventType } from "../domain/types";
import { detectDelayException } from "../agents/exceptionRecoveryAgent";

// ---------------------------------------------------------------------------
// Deterministic simulation engine. Produces the operational disruption
// events NEXUS reacts to, without depending on any external logistics API.
// Every generator here is a natural seam for a future real integration
// (telematics feed, TMS webhook, routing API) — see docs/architecture/
// architecture.md "Replacing the simulator".
// ---------------------------------------------------------------------------

const EVENT_TYPES: SimulationEventType[] = [
  "DRIVER_DELAYED",
  "VEHICLE_UNAVAILABLE",
  "TRAFFIC_INCREASE",
  "APPOINTMENT_UNAVAILABLE",
  "SHIPMENT_PRIORITY_CHANGED",
  "CUSTOMER_REQUEST",
];

function logEvent(event: SimulationEvent) {
  getState().auditLog.push({
    id: nextId("AUD"),
    timestamp: nowIso(),
    actorType: "SYSTEM",
    actorId: "SIMULATION_ENGINE",
    action: `SIM_EVENT_${event.type}`,
    entityType: "Shipment",
    entityId: event.shipmentId,
    agentRunId: null,
    detail: JSON.stringify(event.payload),
  });
}

export async function simulateDriverDelayed(shipmentId: string, delayMin: number) {
  const state = getState();
  const shipment = state.shipments.get(shipmentId);
  if (!shipment) throw new Error(`Unknown shipment ${shipmentId}`);
  if (shipment.driverId) {
    const driver = state.drivers.get(shipment.driverId);
    if (driver) driver.status = "DELAYED";
  }
  const event: SimulationEvent = {
    id: nextId("EVT"),
    type: "DRIVER_DELAYED",
    shipmentId,
    driverId: shipment.driverId,
    payload: { delayMin },
    occurredAt: nowIso(),
  };
  logEvent(event);
  const result = await detectDelayException(shipmentId, delayMin, "DRIVER_DELAYED");
  return { event, ...result };
}

export async function simulateVehicleUnavailable(shipmentId: string, rand: SeededRandom) {
  const state = getState();
  const shipment = state.shipments.get(shipmentId);
  if (!shipment) throw new Error(`Unknown shipment ${shipmentId}`);
  if (shipment.vehicleId) {
    const vehicle = state.vehicles.get(shipment.vehicleId);
    if (vehicle) vehicle.status = "MAINTENANCE";
  }
  const delayMin = rand.int(60, 120);
  const event: SimulationEvent = {
    id: nextId("EVT"),
    type: "VEHICLE_UNAVAILABLE",
    shipmentId,
    driverId: shipment.driverId,
    payload: { vehicleId: shipment.vehicleId, delayMin },
    occurredAt: nowIso(),
  };
  logEvent(event);
  const result = await detectDelayException(
    shipmentId,
    delayMin,
    "VEHICLE_FAILURE",
    `Vehicle ${shipment.vehicleId} flagged unavailable (maintenance) — estimated ${delayMin} min recovery delay.`
  );
  return { event, ...result };
}

export async function simulateTrafficIncrease(shipmentId: string, rand: SeededRandom) {
  const state = getState();
  const shipment = state.shipments.get(shipmentId);
  if (!shipment || !shipment.routeId) throw new Error(`Unknown shipment/route ${shipmentId}`);
  const route = state.routes.get(shipment.routeId);
  if (!route) throw new Error(`Unknown route ${shipment.routeId}`);
  const increase = rand.float(0.25, 0.55, 2);
  route.trafficFactor = Math.round((route.trafficFactor + increase) * 100) / 100;
  const delayMin = Math.round(route.baseDurationMin * increase);
  const event: SimulationEvent = {
    id: nextId("EVT"),
    type: "TRAFFIC_INCREASE",
    shipmentId,
    driverId: shipment.driverId,
    payload: { trafficFactor: route.trafficFactor, delayMin },
    occurredAt: nowIso(),
  };
  logEvent(event);
  const result = await detectDelayException(
    shipmentId,
    delayMin,
    "ROUTE_DISRUPTION",
    `Traffic conditions increased route duration by ${delayMin} min (factor now ${route.trafficFactor}x).`
  );
  return { event, ...result };
}

export async function simulateAppointmentUnavailable(shipmentId: string) {
  const state = getState();
  const shipment = state.shipments.get(shipmentId);
  if (!shipment || !shipment.appointment) throw new Error(`Shipment ${shipmentId} has no appointment`);
  const facility = state.facilities.get(shipment.appointment.facilityId);
  const hour = new Date(shipment.appointment.start).getUTCHours();
  const slot = facility?.appointmentCapacity.find((c) => c.hour === hour);
  if (slot) slot.booked = slot.capacity; // saturate the original slot
  const delayMin = 45;
  const event: SimulationEvent = {
    id: nextId("EVT"),
    type: "APPOINTMENT_UNAVAILABLE",
    shipmentId,
    driverId: shipment.driverId,
    payload: { facilityId: facility?.id, hour },
    occurredAt: nowIso(),
  };
  logEvent(event);
  const result = await detectDelayException(
    shipmentId,
    delayMin,
    "APPOINTMENT_CONFLICT",
    `Original dock appointment at ${facility?.name ?? shipment.appointment.facilityId} is no longer available; recovery required.`
  );
  return { event, ...result };
}

export function simulateShipmentPriorityChanged(shipmentId: string, newPriority: "STANDARD" | "HIGH" | "CRITICAL") {
  const state = getState();
  const shipment = state.shipments.get(shipmentId);
  if (!shipment) throw new Error(`Unknown shipment ${shipmentId}`);
  const before = shipment.priority;
  shipment.priority = newPriority;
  shipment.updatedAt = nowIso();
  const event: SimulationEvent = {
    id: nextId("EVT"),
    type: "SHIPMENT_PRIORITY_CHANGED",
    shipmentId,
    driverId: shipment.driverId,
    payload: { from: before, to: newPriority },
    occurredAt: nowIso(),
  };
  logEvent(event);
  return { event };
}

export function simulateCustomerRequest(shipmentId: string, requestText: string) {
  const state = getState();
  const shipment = state.shipments.get(shipmentId);
  if (!shipment) throw new Error(`Unknown shipment ${shipmentId}`);
  const event: SimulationEvent = {
    id: nextId("EVT"),
    type: "CUSTOMER_REQUEST",
    shipmentId,
    driverId: shipment.driverId,
    payload: { requestText },
    occurredAt: nowIso(),
  };
  logEvent(event);
  state.communications.push({
    id: nextId("COMM"),
    shipmentId,
    agentRunId: null,
    channel: "CUSTOMER",
    recipient: "NEXUS Ops Inbox",
    subject: `Inbound request from ${shipment.customerName}`,
    body: requestText,
    sentAt: nowIso(),
    simulated: true,
  });
  return { event };
}

/** Fires one random eligible simulation event, for open-ended exploration in the UI. */
export async function simulateRandomEvent(seed: number) {
  const rand = new SeededRandom(seed);
  const state = getState();
  const active = Array.from(state.shipments.values()).filter(
    (s) => s.status === "IN_TRANSIT" || s.status === "SCHEDULED"
  );
  if (active.length === 0) return null;
  const shipment = rand.pick(active);
  const type = rand.pick(EVENT_TYPES);

  switch (type) {
    case "DRIVER_DELAYED":
      return simulateDriverDelayed(shipment.id, rand.int(20, 90));
    case "VEHICLE_UNAVAILABLE":
      return simulateVehicleUnavailable(shipment.id, rand);
    case "TRAFFIC_INCREASE":
      return simulateTrafficIncrease(shipment.id, rand);
    case "APPOINTMENT_UNAVAILABLE":
      return shipment.appointment
        ? simulateAppointmentUnavailable(shipment.id)
        : simulateDriverDelayed(shipment.id, rand.int(20, 60));
    case "SHIPMENT_PRIORITY_CHANGED":
      return simulateShipmentPriorityChanged(shipment.id, rand.pick(["HIGH", "CRITICAL"] as const));
    case "CUSTOMER_REQUEST":
      return simulateCustomerRequest(shipment.id, "Customer requesting earliest possible delivery confirmation.");
  }
}
