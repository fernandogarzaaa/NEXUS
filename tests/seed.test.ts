import { describe, expect, it } from "vitest";
import { generateSeedData } from "@/lib/domain/seed";

describe("seed data generation", () => {
  it("leaves idle dispatch-candidate drivers (AVAILABLE) with no default shipment assignments", () => {
    // Regression: the round-robin shipment assignment loop used to assign
    // shipments to every driver, including the ones deliberately marked
    // AVAILABLE as free reassignment capacity for findAlternativeDriver —
    // making them just as loaded as everyone else and defeating the point
    // of having genuinely idle capacity in the demo dataset.
    const { drivers } = generateSeedData();
    const idleDrivers = drivers.filter((d) => d.status === "AVAILABLE");
    expect(idleDrivers.length).toBeGreaterThan(0);
    for (const driver of idleDrivers) {
      expect(driver.assignedShipmentIds).toEqual([]);
    }
  });

  it("still assigns every non-idle driver at least one shipment", () => {
    const { drivers } = generateSeedData();
    const activeDrivers = drivers.filter((d) => d.status !== "AVAILABLE");
    for (const driver of activeDrivers) {
      expect(driver.assignedShipmentIds.length).toBeGreaterThan(0);
    }
  });
});
