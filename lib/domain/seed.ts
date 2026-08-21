import { SeededRandom } from "./rng";
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
export const DEMO_EPOCH_MS = Date.UTC(2026, 7, 17, 8, 0, 0); // Mon 2026-08-17 08:00 UTC
export const DEMO_SEED = 20260817;

function iso(offsetMin: number): string {
  return new Date(DEMO_EPOCH_MS + offsetMin * 60_000).toISOString();
}

const FACILITY_SEED: Array<Omit<Facility, "appointmentCapacity">> = [
  {
    id: "FAC-DAL",
    name: "Dallas Regional DC",
    type: "DISTRIBUTION_CENTER",
    city: "Dallas",
    state: "TX",
    location: { lat: 32.7767, lng: -96.797 },
    operatingHoursStart: 6,
    operatingHoursEnd: 20,
  },
  {
    id: "FAC-HOU",
    name: "Houston Gulf Warehouse",
    type: "WAREHOUSE",
    city: "Houston",
    state: "TX",
    location: { lat: 29.7604, lng: -95.3698 },
    operatingHoursStart: 6,
    operatingHoursEnd: 22,
  },
  {
    id: "FAC-AUS",
    name: "Austin Cross-Dock",
    type: "DISTRIBUTION_CENTER",
    city: "Austin",
    state: "TX",
    location: { lat: 30.2672, lng: -97.7431 },
    operatingHoursStart: 7,
    operatingHoursEnd: 19,
  },
  {
    id: "FAC-SAT",
    name: "San Antonio Customer Site",
    type: "CUSTOMER_SITE",
    city: "San Antonio",
    state: "TX",
    location: { lat: 29.4241, lng: -98.4936 },
    operatingHoursStart: 8,
    operatingHoursEnd: 17,
  },
  {
    id: "FAC-FTW",
    name: "Fort Worth Distribution Hub",
    type: "DISTRIBUTION_CENTER",
    city: "Fort Worth",
    state: "TX",
    location: { lat: 32.7555, lng: -97.3308 },
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
  "Lonestar Retail Group",
  "Alamo Foods Co-op",
  "Gulf Coast Manufacturing",
  "Hill Country Hardware",
  "Metroplex Electronics",
  "Bayou Fresh Produce",
  "Rio Grande Textiles",
  "Longhorn Auto Parts",
  "Piney Woods Lumber",
  "Cactus Rose Pharmacy",
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
    capacityLbs: rand.int(8000, 45000),
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

function distanceMiles(a: Facility["location"], b: Facility["location"]): number {
  // Rough flat-earth approximation; adequate for demo-scale distances in TX.
  const dLat = (a.lat - b.lat) * 69;
  const dLng = (a.lng - b.lng) * 54.6;
  return Math.round(Math.sqrt(dLat * dLat + dLng * dLng) * 10) / 10;
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

    const driver = drivers[i % drivers.length];
    const vehicle = vehicles.find((v) => v.id === driver.vehicleId) ?? rand.pick(vehicles);
    const priority = rand.weightedPick(priorityWeights);
    const dist = Math.max(18, distanceMiles(origin.location, destination.location));
    const baseDurationMin = Math.round((dist / 52) * 60);

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
      weightLbs: rand.int(1200, Math.min(vehicle.capacityLbs, 42000)),
      distanceMiles: dist,
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
      distanceMiles: dist,
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
  const heroOrigin = facilities.find((f) => f.id === "FAC-DAL")!;
  const heroDestination = facilities.find((f) => f.id === "FAC-AUS")!;
  const heroDist = distanceMiles(heroOrigin.location, heroDestination.location);
  const heroBaseDurationMin = Math.round((heroDist / 52) * 60);
  const heroDepartureOffset = -40; // already in transit at demo start
  const heroScheduledEtaOffset = heroDepartureOffset + heroBaseDurationMin;
  const heroVehicle = vehicles.find((v) => v.id === heroDriver.vehicleId)!;

  const heroShipment: Shipment = {
    id: "SHP-2000",
    referenceCode: `NX-${seed % 1000}-HERO`,
    customerName: "Metroplex Electronics",
    originFacilityId: heroOrigin.id,
    destinationFacilityId: heroDestination.id,
    driverId: heroDriver.id,
    vehicleId: heroVehicle.id,
    routeId: "RTE-SHP-2000",
    status: "IN_TRANSIT",
    priority: "CRITICAL",
    weightLbs: 8200,
    distanceMiles: heroDist,
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
    distanceMiles: heroDist,
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
