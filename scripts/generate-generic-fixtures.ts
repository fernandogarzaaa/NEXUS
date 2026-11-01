// Regenerate adapters/generic/*.csv from the deterministic demo seed, in a
// legacy-style shape (short depot codes, numeric ids, local status words),
// plus the deliberate anomalies the reconciliation and migration tests rely
// on. Usage: npm run fixtures:generic
import fs from "node:fs";
import path from "node:path";
import { generateSeedData } from "../lib/domain/seed";

const OUT = path.join(process.cwd(), "adapters", "generic");
const strip = (prefix: string) => (v: string | null | undefined) => (v ? v.replace(prefix, "") : "");
const depot = strip("FAC-");
const drv = strip("D-");
const fleet = strip("VEH-");
const con = strip("SHP-");

function cell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function write(name: string, header: string[], rows: unknown[][]) {
  const text = [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
  fs.writeFileSync(path.join(OUT, name), text);
  console.log(`${name}: ${rows.length} rows`);
}

const d = generateSeedData();
const STATUS: Record<string, string> = { SCHEDULED: "BOOKED", IN_TRANSIT: "ON ROAD", AT_FACILITY: "AT DEPOT", EXCEPTION: "HELD", DELIVERED: "POD", CANCELLED: "CANX" };
const PRIORITY: Record<string, string> = { CRITICAL: "1", HIGH: "2", STANDARD: "3" };

const picked = ["SHP-1000", "SHP-1001", "SHP-1002", "SHP-1003", "SHP-1004", "SHP-1005", "SHP-2000"];
const shipmentRow = (s: (typeof d.shipments)[number]) => [
  con(s.id), s.referenceCode, s.customerName, depot(s.originFacilityId), depot(s.destinationFacilityId), drv(s.driverId), fleet(s.vehicleId),
  STATUS[s.status], PRIORITY[s.priority], s.weightKg, s.distanceKm, s.deliveryWindowStart, s.deliveryWindowEnd, s.scheduledEta, s.currentEta,
  depot(s.appointment?.facilityId), s.appointment?.start ?? "", s.appointment?.end ?? "", s.appointment?.status ?? "", s.createdAt, s.updatedAt,
];
const shipments = picked.map((id) => shipmentRow(d.shipments.find((s) => s.id === id)!));
const dup = [...shipments[3]]; // exact duplicate of 1003 (line 9)
const heroConflict = [...shipments[6]]; // second, conflicting row for the hero consignment (line 10)
heroConflict[5] = "02";
heroConflict[6] = "02";
const unknown = ["9999", "NX-LEGACY-9999", "Outback Freight Pty Ltd", "SYD", "NTL", "02", "02", "BOOKED", "3", "540", "141.2",
  "2026-08-18T09:00:00.000Z", "2026-08-18T11:00:00.000Z", "2026-08-18T10:00:00.000Z", "2026-08-18T10:00:00.000Z",
  "NTL", "2026-08-18T09:45:00.000Z", "2026-08-18T10:30:00.000Z", "SCHEDULED", "2026-08-17T20:00:00.000Z", "2026-08-17T20:00:00.000Z"]; // unmatched (line 11)
const broken = ["1050", "NX-817-1050", "", "SYD", "CBR", "05", "05", "UNKNOWN", "3", "not-a-number", "234",
  "2026-08-17T04:00:00.000Z", "2026-08-17T06:00:00.000Z", "2026-08-17T05:00:00.000Z", "2026-08-17T05:00:00.000Z",
  "", "", "", "", "2026-08-17T00:00:00.000Z", "2026-08-17T00:00:00.000Z"]; // quarantined (line 12)
write("shipments.csv",
  ["ConsignmentNo", "RefCode", "Consignee", "FromDepot", "ToDepot", "DriverCode", "Fleet", "Status", "PriorityCode", "WeightKg", "DistanceKm", "WindowFrom", "WindowTo", "PlannedETA", "CurrentETA", "ApptDepot", "ApptFrom", "ApptTo", "ApptStatus", "Created", "Updated"],
  [...shipments, dup, heroConflict, unknown, broken]);

write("drivers.csv",
  ["DriverCode", "FullName", "HomeDepot", "DutyStatus", "Lat", "Lng", "AssignedConsignments", "HosHours", "OnTimePct", "Fleet"],
  [
    ...d.drivers.map((x) => [drv(x.id), x.name, depot(x.homeFacilityId), x.status, x.location.lat, x.location.lng,
      x.assignedShipmentIds.map(con).join(";"), x.hoursOfServiceRemaining, Math.round(x.onTimeRating * 100), fleet(x.vehicleId)]),
    ["11", "Legacy Only Driver", "SYD", "OFF_DUTY", "n/a", "150.85", "", "6.0", "91", ""], // unparsable latitude
  ]);

write("vehicles.csv", ["Fleet", "BodyType", "PayloadKg", "Status", "DriverCode"],
  d.vehicles.map((v) => [fleet(v.id), v.type, v.capacityKg, v.status, drv(v.currentDriverId)]));

write("facilities.csv", ["DepotCode", "DepotName", "DepotType", "City", "State", "Lat", "Lng", "OpensHour", "ClosesHour"],
  d.facilities.map((f) => [depot(f.id), f.name, f.type, f.city, f.state, f.location.lat, f.location.lng, f.operatingHoursStart, f.operatingHoursEnd]));
