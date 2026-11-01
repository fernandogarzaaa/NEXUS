import { afterEach, describe, expect, it, vi } from "vitest";
import { currencyCode, formatLocal, formatMoney, haversineKm, hoursNeeded, localHour, operatingTimezone } from "@/lib/domain/locale";
import { generateSeedData, HERO_SHIPMENT_ID } from "@/lib/domain/seed";
import { evaluatePolicy } from "@/lib/agents/policyEngine";
import { resetState } from "@/lib/domain/store";

describe("deployment locale", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to Sydney time and Australian dollars, both configurable", () => {
    expect(operatingTimezone({})).toBe("Australia/Sydney");
    expect(currencyCode({})).toBe("AUD");
    expect(operatingTimezone({ NEXUS_TIMEZONE: "Australia/Perth" })).toBe("Australia/Perth");
    expect(currencyCode({ NEXUS_CURRENCY: "nzd" })).toBe("NZD");
  });

  it("reads local hours across the UTC date line and daylight saving", () => {
    expect(localHour("2026-08-16T22:00:00.000Z", "Australia/Sydney")).toBe(8); // AEST, UTC+10
    expect(localHour("2026-12-16T22:00:00.000Z", "Australia/Sydney")).toBe(9); // AEDT, UTC+11
    expect(localHour("2026-08-16T22:00:00.000Z", "Australia/Perth")).toBe(6);
    expect(formatLocal("2026-08-16T22:00:00.000Z", "Australia/Sydney")).toMatch(/Mon,? 17 Aug,? 08:00/);
  });

  it("formats money unambiguously in the deployment currency", () => {
    expect(formatMoney(25, "AUD")).toBe("A$25.00");
    expect(formatMoney(650, "USD")).toBe("$650.00");
  });

  it("measures distance in kilometres", () => {
    expect(haversineKm({ lat: -33.8688, lng: 151.2093 }, { lat: -37.8136, lng: 144.9631 })).toBeCloseTo(713.4, 0); // Sydney-Melbourne
    expect(hoursNeeded(144)).toBe(2);
  });

  it("states policy reasons in the deployment currency", () => {
    resetState();
    vi.stubEnv("NEXUS_CURRENCY", "AUD");
    expect(evaluatePolicy("APPOINTMENT_RESCHEDULE", 25).reason).toContain("A$25.00 <= A$100.00 threshold");
    expect(evaluatePolicy("APPOINTMENT_RESCHEDULE", 250).reason).toContain("A$250.00 exceeds the A$100.00");
  });
});

describe("Australian demo network", () => {
  const data = generateSeedData();

  it("is a regional NSW/ACT network in metric units", () => {
    expect(data.facilities.map((f) => `${f.id} ${f.state}`)).toEqual(["FAC-SYD NSW", "FAC-NTL NSW", "FAC-CBR ACT", "FAC-WOL NSW", "FAC-GLB NSW"]);
    const maxKm = Math.max(...data.shipments.map((s) => s.distanceKm));
    expect(maxKm).toBeLessThan(400); // regional runs: every leg fits a driver's shift
    expect(data.vehicles.every((v) => v.capacityKg >= 3600 && v.capacityKg <= 20400)).toBe(true);
    expect(data.shipments.every((s) => s.weightKg <= 19000)).toBe(true);
  });

  it("runs the hero shipment Sydney to Canberra, arriving mid-morning local time", () => {
    const hero = data.shipments.find((s) => s.id === HERO_SHIPMENT_ID)!;
    expect([hero.originFacilityId, hero.destinationFacilityId, hero.priority, hero.driverId]).toEqual(["FAC-SYD", "FAC-CBR", "CRITICAL", "D-07"]);
    expect(localHour(hero.scheduledEta, "Australia/Sydney")).toBe(10);
    // The 45-minute delay lands in an appointment slot the Canberra dock actually has.
    const cbr = data.facilities.find((f) => f.id === "FAC-CBR")!;
    const delayedHour = localHour(Date.parse(hero.appointment!.start) + 45 * 60_000, "Australia/Sydney");
    expect(cbr.appointmentCapacity.some((c) => c.hour === delayedHour)).toBe(true);
  });
});
