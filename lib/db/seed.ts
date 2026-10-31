import type { Pool } from "pg";
import { DEMO_SEED } from "../domain/seed";
import { PostgresStateRepository } from "../domain/postgresRepository";

export interface SeedSummary {
  seed: number;
  facilities: number;
  vehicles: number;
  drivers: number;
  shipments: number;
  routes: number;
  policies: number;
}

/**
 * Load the deterministic demo set into Postgres through the same repository
 * the application uses, so a seeded database is indistinguishable from one
 * the app seeded itself on first start. Refuses to overwrite existing data
 * unless `force` is set.
 */
export async function seedDatabase(pool: Pool, opts: { seed?: number; force?: boolean } = {}): Promise<SeedSummary> {
  const repo = new PostgresStateRepository(pool);
  if (!opts.force && (await repo.hasData())) {
    throw new Error("Database already holds NEXUS data; re-run with --force to replace it with the demo set");
  }
  const state = repo.resetState(opts.seed ?? DEMO_SEED);
  await repo.persist();
  return {
    seed: state.seed,
    facilities: state.facilities.size,
    vehicles: state.vehicles.size,
    drivers: state.drivers.size,
    shipments: state.shipments.size,
    routes: state.routes.size,
    policies: state.policies.size,
  };
}
