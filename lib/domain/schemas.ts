import { z } from "zod";
import type { Driver, Facility, Shipment, Vehicle } from "./types";

// Zod schemas for the four canonical operational entities. They mirror
// lib/domain/types.ts exactly (enforced by the `satisfies` clauses) and are
// what the adapter/migration layer validates mapped legacy rows against.

const isoDate = z
  .string()
  .refine((s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(s) && !Number.isNaN(Date.parse(s)), {
    message: "expected an ISO-8601 timestamp",
  });

const geoPoint = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

export const shipmentSchema = z.object({
  id: z.string().min(1),
  referenceCode: z.string().min(1),
  customerName: z.string().min(1),
  originFacilityId: z.string().min(1),
  destinationFacilityId: z.string().min(1),
  driverId: z.string().min(1).nullable(),
  vehicleId: z.string().min(1).nullable(),
  routeId: z.string().min(1).nullable(),
  status: z.enum(["SCHEDULED", "IN_TRANSIT", "AT_FACILITY", "EXCEPTION", "DELIVERED", "CANCELLED"]),
  priority: z.enum(["STANDARD", "HIGH", "CRITICAL"]),
  weightKg: z.number().nonnegative(),
  distanceKm: z.number().nonnegative(),
  deliveryWindowStart: isoDate,
  deliveryWindowEnd: isoDate,
  scheduledEta: isoDate,
  currentEta: isoDate,
  appointment: z
    .object({
      facilityId: z.string().min(1),
      start: isoDate,
      end: isoDate,
      status: z.enum(["SCHEDULED", "CONFIRMED", "MISSED", "RESCHEDULED"]),
    })
    .nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
}) satisfies z.ZodType<Shipment>;

export const driverSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  homeFacilityId: z.string().min(1),
  status: z.enum(["AVAILABLE", "ON_ROUTE", "DELAYED", "OFF_DUTY"]),
  location: geoPoint,
  assignedShipmentIds: z.array(z.string().min(1)),
  hoursOfServiceRemaining: z.number().nonnegative(),
  onTimeRating: z.number().min(0).max(1),
  vehicleId: z.string().min(1).nullable(),
}) satisfies z.ZodType<Driver>;

export const vehicleSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["DRY_VAN", "REEFER", "FLATBED", "BOX_TRUCK"]),
  capacityKg: z.number().nonnegative(),
  status: z.enum(["AVAILABLE", "IN_USE", "MAINTENANCE"]),
  currentDriverId: z.string().min(1).nullable(),
}) satisfies z.ZodType<Vehicle>;

export const facilitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["WAREHOUSE", "DISTRIBUTION_CENTER", "CUSTOMER_SITE"]),
  city: z.string().min(1),
  state: z.string().min(1),
  location: geoPoint,
  operatingHoursStart: z.number().int().min(0).max(23),
  operatingHoursEnd: z.number().int().min(0).max(24),
  appointmentCapacity: z.array(
    z.object({ hour: z.number().int(), capacity: z.number().int().nonnegative(), booked: z.number().int().nonnegative() })
  ),
}) satisfies z.ZodType<Facility>;

export type CanonicalEntity = "shipment" | "driver" | "vehicle" | "facility";

export const CANONICAL_ENTITIES: readonly CanonicalEntity[] = ["shipment", "driver", "vehicle", "facility"];

export const canonicalSchemas: Record<CanonicalEntity, z.ZodType> = {
  shipment: shipmentSchema,
  driver: driverSchema,
  vehicle: vehicleSchema,
  facility: facilitySchema,
};
