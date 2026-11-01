import { SeededRandom } from "./rng";
import { PLANNING_SPEED_KMH, haversineKm } from "./locale";
import type {
  Driver,
  Facility,
  Route,
  Shipment,
  ShipmentPriority,
  Vehicle,
  VehicleType,
} from "./types";

// Fixed anchor so every seeded run produces identical timestamps —
// required for the hero demo script and for deterministic tests.
// Mon 2026-08-17 08:00 in Sydney (AEST, UTC+10; no daylight saving in August).
export const DEMO_EPOCH_MS = Date.UTC(2026, 7, 16, 22, 0, 0);
export const DEMO_SEED = 20260817;

function iso(offsetMin: number): string {
  return new Date(DEMO_EPOCH_MS + offsetMin * 60_000).toISOString();
}

// A regional New South Wales / ACT network for the demo. Facility names are
// fictional; coordinates are the real suburbs so distances are realistic.
// Operating hours are local (see lib/domain/locale.ts).
const FACILITY_SEED: Array<Omit<Facility, "appointmentCapacity">> = [
  {
    id: "FAC-SYD",
    name: "Sydney Distribution Centre (Eastern Creek)",
    type: "DISTRIBUTION_CENTER",
    city: "Sydney",
    state: "NSW",
    location: { lat: -33.8018, lng: 150.8538 },
    operatingHoursStart: 6,
    operatingHoursEnd: 20,
  },
  {
    id: "FAC-NTL",
    name: "Newcastle Port Warehouse (Beresfield)",
    type: "WAREHOUSE",
    city: "Newcastle",
    state: "NSW",
    location: { lat: -32.7992, lng: 151.6489 },
    operatingHoursStart: 6,
    operatingHoursEnd: 22,
  },
  {
    id: "FAC-CBR",
    name: "Canberra Cross-Dock (Hume)",
    type: "DISTRIBUTION_CENTER",
    city: "Canberra",
    state: "ACT",
    location: { lat: -35.3876, lng: 149.1625 },
    operatingHoursStart: 7,
    operatingHoursEnd: 19,
  },
  {
    id: "FAC-WOL",
    name: "Wollongong Customer Site (Unanderra)",
    type: "CUSTOMER_SITE",
    city: "Wollongong",
    state: "NSW",
    location: { lat: -34.4535, lng: 150.8424 },
    operatingHoursStart: 8,
    operatingHoursEnd: 17,
  },
  {
    id: "FAC-GLB",
    name: "Goulburn Regional Hub",
    type: "DISTRIBUTION_CENTER",
    city: "Goulburn",
    state: "NSW",
    location: { lat: -34.7546, lng: 149.7186 },
    operatingHoursStart: 6,
    operatingHoursEnd: 21,
  },
];

const DRIVER_NAMES = [
  "Marcus Alvarez",
  "Priya Nair",
  "Jalen Brooks",
  "Sofia Reyes",
  "Devon Clarke",
  "Aisha Thompson",
  "Ethan Walsh",
  "Nina Kowalski",
  "Carlos Mendez",
  "Grace Okafor",
];

const CUSTOMER_NAMES = [
  "Harbour City Retail Group",
  "Hunter Valley Foods Co-op",
  "Illawarra Fabrication",
  "Southern Highlands Hardware",
  "Parramatta Electronics",
  "Riverina Fresh Produce",
  "Monaro Textiles",
  "Western Sydney Auto Parts",
  "Blue Mountains Timber",
  "Waratah Pharmacy",
];

const VEHICLE_TYPES: VehicleType[] = ["DRY_VAN", "REEFER", "FLATBED", "BOX_TRUCK"];

function buildFacilities(rand: SeededRandom): Facility[] {
  return FACILITY_SEED.map((f) => ({
    ...f,
    appointmentCapacity: Array.from({ length: f.operatingHoursEnd - f.operatingHoursStart }, (_, i) => ({
      hour: f.operatingHoursStart + i,
      capacity: rand.int(2, 4),
      booked: 0,
    })),
  }));
}

function buildVehicles(rand: SeededRandom, count: number): Vehicle[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `VEH-${String(i + 1).padStart(2, "0")}`,
    type: rand.pick(VEHICLE_TYPES),
    capacityKg: rand.int(3600, 20400),
    status: "AVAILABLE" as const,
    currentDriverId: null,
  }));
}

// Drivers left genuinely idle (not "D-07", which starts on-route so the
// hero scenario can delay it) so findAlternativeDriver has real,
// deterministic candidates for both the hero demo and the Dynamic
// Dispatch Agent's standing reassignment sweep.
const IDLE_DRIVER_INDEXES = new Set([1, 3, 8]); // D-02, D-04, D-09

function buildDrivers(rand: SeededRandom, facilities: Facility[], vehicles: Vehicle[]): Driver[] {
  return DRIVER_NAMES.map((name, i) => {
    const home = facilities[i % facilities.length];
    const vehicle = vehicles[i];
    const driver: Driver = {
      id: `D-${String(i + 1).padStart(2, "0")}`,
      name,
      homeFacilityId: home.id,
      status: IDLE_DRIVER_INDEXES.has(i) ? "AVAILABLE" : "ON_ROUTE",
      location: {
        lat: home.location.lat + rand.float(-0.15, 0.15, 4),
        lng: home.location.lng + rand.float(-0.15, 0.15, 4),
      },
      assignedShipmentIds: [],
      hoursOfServiceRemaining: rand.float(4, 11, 1),
      onTimeRating: rand.float(0.82, 0.99, 2),
      vehicleId: vehicle?.id ?? null,
    };
    if (vehicle) vehicle.currentDriverId = driver.id;
    return driver;
  });
}

function transitMinutes(distanceKm: number): number {
  return Math.round((distanceKm / PLANNING_SPEED_KMH) * 60);
}

export interface SeedData {
  facilities: Facility[];
  vehicles: Vehicle[];
  drivers: Driver[];
  shipments: Shipment[];
  routes: Route[];
}

export function generateSeedData(seed: number = DEMO_SEED, shipmentCount = 62): SeedData {
  const rand = new SeededRandom(seed);
  const facilities = buildFacilities(rand);
  const vehicles = buildVehicles(rand, 14);
  const drivers = buildDrivers(rand, facilities, vehicles);
  // Idle drivers (see IDLE_DRIVER_INDEXES) stay out of the default
  // round-robin assignment pool, so they're genuinely free capacity for
  // findAlternativeDriver rather than already-loaded "available" drivers.
  const assignableDrivers = drivers.filter((d) => d.status !== "AVAILABLE");

  const shipments: Shipment[] = [];
  const routes: Route[] = [];
  const priorityWeights: [ShipmentPriority, number][] = [
    ["STANDARD", 60],
    ["HIGH", 30],
    ["CRITICAL", 10],
  ];

  for (let i = 0; i < shipmentCount; i++) {
    const id = `SHP-${String(1000 + i)}`;
    const origin = rand.pick(facilities);
    let destination = rand.pick(facilities);
    while (destination.id === origin.id) destination = rand.pick(facilities);

    const driver = assignableDrivers[i % assignableDrivers.length];
    const vehicle = vehicles.find((v) => v.id === driver.vehicleId) ?? rand.pick(vehicles);
    const priority = rand.weightedPick(priorityWeights);
    const dist = Math.max(30, haversineKm(origin.location, destination.location));
    const baseDurationMin = transitMinutes(dist);

    // Stagger departures across a 24h operational window.
    const departureOffset = rand.int(-180, 420);
    const scheduledEtaOffset = departureOffset + baseDurationMin;
    const windowSlack = priority === "CRITICAL" ? 30 : priority === "HIGH" ? 60 : 120;

    const status: Shipment["status"] =
      departureOffset < -60 ? "IN_TRANSIT" : departureOffset < 0 ? "IN_TRANSIT" : "SCHEDULED";

    const shipment: Shipment = {
      id,
      referenceCode: `NX-${seed % 1000}-${1000 + i}`,
      customerName: CUSTOMER_NAMES[i % CUSTOMER_NAMES.length],
      originFacilityId: origin.id,
      destinationFacilityId: destination.id,
      driverId: driver.id,
      vehicleId: vehicle.id,
      routeId: `RTE-${id}`,
      status,
      priority,
      weightKg: rand.int(550, Math.min(vehicle.capacityKg, 19000)),
      distanceKm: dist,
      deliveryWindowStart: iso(scheduledEtaOffset - windowSlack / 2),
      deliveryWindowEnd: iso(scheduledEtaOffset + windowSlack),
      scheduledEta: iso(scheduledEtaOffset),
      currentEta: iso(scheduledEtaOffset),
      appointment:
        destination.type !== "CUSTOMER_SITE"
          ? {
              facilityId: destination.id,
              start: iso(scheduledEtaOffset - 15),
              end: iso(scheduledEtaOffset + 30),
              status: "SCHEDULED",
            }
          : null,
      createdAt: iso(departureOffset - rand.int(30, 240)),
      updatedAt: iso(departureOffset),
    };

    shipments.push(shipment);
    driver.assignedShipmentIds.push(shipment.id);

    routes.push({
      id: shipment.routeId!,
      shipmentId: shipment.id,
      originFacilityId: origin.id,
      destinationFacilityId: destination.id,
      distanceKm: dist,
      baseDurationMin,
      trafficFactor: rand.float(0.95, 1.15, 2),
      waypoints: [
        { ...origin.location, label: origin.name },
        { ...destination.location, label: destination.name },
      ],
    });
  }

  // Designated hero shipment for the deterministic demo scenario (see
  // lib/sim/heroDemo.ts and docs/demo/demo-script.md). Built explicitly,
  // rather than left to the random distribution above, so "Driver D-07
  // delayed by 45 min" always produces a genuine, reproducible
  // delivery-window violation with a feasible appointment reschedule.
  const heroDriver = drivers.find((d) => d.id === "D-07")!;
  const heroOrigin = facilities.find((f) => f.id === "FAC-SYD")!;
  const heroDestination = facilities.find((f) => f.id === "FAC-CBR")!;
  const heroDist = haversineKm(heroOrigin.location, heroDestination.location);
  const heroBaseDurationMin = transitMinutes(heroDist);
  const heroDepartureOffset = -40; // already in transit at demo start
  const heroScheduledEtaOffset = heroDepartureOffset + heroBaseDurationMin;
  const heroVehicle = vehicles.find((v) => v.id === heroDriver.vehicleId)!;

  const heroShipment: Shipment = {
    id: "SHP-2000",
    referenceCode: `NX-${seed % 1000}-HERO`,
    customerName: "Parramatta Electronics",
    originFacilityId: heroOrigin.id,
    destinationFacilityId: heroDestination.id,
    driverId: heroDriver.id,
    vehicleId: heroVehicle.id,
    routeId: "RTE-SHP-2000",
    status: "IN_TRANSIT",
    priority: "CRITICAL",
    weightKg: 3700,
    distanceKm: heroDist,
    deliveryWindowStart: iso(heroScheduledEtaOffset - 15),
    deliveryWindowEnd: iso(heroScheduledEtaOffset + 20),
    scheduledEta: iso(heroScheduledEtaOffset),
    currentEta: iso(heroScheduledEtaOffset),
    appointment: {
      facilityId: heroDestination.id,
      start: iso(heroScheduledEtaOffset - 15),
      end: iso(heroScheduledEtaOffset + 30),
      status: "SCHEDULED",
    },
    createdAt: iso(heroDepartureOffset - 90),
    updatedAt: iso(heroDepartureOffset),
  };
  shipments.push(heroShipment);
  heroDriver.assignedShipmentIds.unshift(heroShipment.id);
  routes.push({
    id: heroShipment.routeId!,
    shipmentId: heroShipment.id,
    originFacilityId: heroOrigin.id,
    destinationFacilityId: heroDestination.id,
    distanceKm: heroDist,
    baseDurationMin: heroBaseDurationMin,
    trafficFactor: 1.05,
    waypoints: [
      { ...heroOrigin.location, label: heroOrigin.name },
      { ...heroDestination.location, label: heroDestination.name },
    ],
  });

  return { facilities, vehicles, drivers, shipments, routes };
}

export const HERO_SHIPMENT_ID = "SHP-2000";
export const HERO_DRIVER_ID = "D-07";
