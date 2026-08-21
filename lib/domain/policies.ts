import type { Policy } from "./types";

// Default autonomy policy set. Editable at runtime through the Policy
// Configuration screen / POST /api/policies — see docs/product/PRD.md
// section on Human Oversight for the governance rationale.
export function defaultPolicies(): Policy[] {
  return [
    {
      id: "POL-NOTIFY-CUSTOMER",
      actionType: "CUSTOMER_NOTIFICATION",
      label: "Customer ETA / delay notification",
      description: "Notify a customer of an ETA change, delay, or delivery-window update.",
      autonomyLevel: "LOW_RISK_AUTONOMOUS",
      maxCostUsd: 0,
      editable: true,
    },
    {
      id: "POL-RESCHEDULE-APPT",
      actionType: "APPOINTMENT_RESCHEDULE",
      label: "Facility appointment reschedule",
      description: "Rebook a delivery/dock appointment at the destination facility.",
      autonomyLevel: "LOW_RISK_AUTONOMOUS",
      maxCostUsd: 100,
      editable: true,
    },
    {
      id: "POL-ADJUST-ROUTE",
      actionType: "ROUTE_ADJUSTMENT",
      label: "Route adjustment",
      description: "Recalculate or reorder a route in response to traffic or delay.",
      autonomyLevel: "OPERATIONAL_AUTONOMOUS",
      maxCostUsd: 150,
      editable: true,
    },
    {
      id: "POL-REASSIGN-DRIVER",
      actionType: "DRIVER_REASSIGNMENT",
      label: "Driver / dispatch reassignment",
      description: "Reassign a shipment to a different driver or vehicle.",
      autonomyLevel: "HIGH_IMPACT_APPROVAL",
      maxCostUsd: null,
      editable: true,
    },
    {
      id: "POL-CARRIER-REBOOK",
      actionType: "CARRIER_REBOOK",
      label: "Carrier rebooking / expedite",
      description:
        "Book an outside carrier or expedited service to recover a shipment. Autonomous under the cost threshold; escalates above it.",
      autonomyLevel: "OPERATIONAL_AUTONOMOUS",
      maxCostUsd: 500,
      editable: true,
    },
  ];
}
