// Deployment locale: units, currency and the operating timezone.
//
// Canonical quantities are metric (kilograms, kilometres). Money amounts are
// plain numbers in the deployment currency (NEXUS_CURRENCY, default AUD), so
// field names carry no currency. Facility operating hours and appointment
// slots are in the operating timezone (NEXUS_TIMEZONE, default
// Australia/Sydney); stored timestamps stay ISO-8601 UTC.

export const DEFAULT_TIMEZONE = "Australia/Sydney";
export const DEFAULT_CURRENCY = "AUD";

/** Average line-haul speed used to plan transit time. */
export const PLANNING_SPEED_KMH = 84;
/** Conservative speed used to check a driver's remaining hours can cover a run. */
export const HOURS_CHECK_SPEED_KMH = 72;

export function operatingTimezone(env: Record<string, string | undefined> = process.env): string {
  return (env.NEXUS_TIMEZONE ?? "").trim() || DEFAULT_TIMEZONE;
}

export function currencyCode(env: Record<string, string | undefined> = process.env): string {
  return ((env.NEXUS_CURRENCY ?? "").trim() || DEFAULT_CURRENCY).toUpperCase();
}

/** Hour of day (0-23) of an instant in the operating timezone. */
export function localHour(instant: string | number | Date, timeZone: string = operatingTimezone()): number {
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone, hour: "numeric", hourCycle: "h23" }).formatToParts(new Date(instant));
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
}

/** e.g. "Mon 17 Aug, 10:52 AEST" in the operating timezone. */
export function formatLocal(instant: string | number | Date, timeZone: string = operatingTimezone()): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(new Date(instant));
}

/** e.g. "10:52" in the operating timezone. */
export function formatLocalTime(instant: string | number | Date, timeZone: string = operatingTimezone()): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(instant));
}

/** e.g. "A$25.00" (AUD) or "$25.00" (USD): unambiguous outside the home market too. */
export function formatMoney(amount: number, currency: string = currencyCode()): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
}

/** Great-circle distance in kilometres, one decimal. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
}

/** Hours a driver needs to cover `distanceKm` (used against hours of service). */
export function hoursNeeded(distanceKm: number): number {
  return distanceKm / HOURS_CHECK_SPEED_KMH;
}
