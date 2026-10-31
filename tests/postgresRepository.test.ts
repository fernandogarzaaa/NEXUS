import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { runMigrations } from "@/lib/db/migrate";
import { seedDatabase } from "@/lib/db/seed";
import { PostgresStateRepository } from "@/lib/domain/postgresRepository";
import { InMemoryStateRepository } from "@/lib/domain/repository";
import { serializeState } from "@/lib/domain/state";
import { getState, loadState, persistState, resetState, setRepository } from "@/lib/domain/store";
import { HERO_SHIPMENT_ID } from "@/lib/domain/seed";
import { runHeroDemo } from "@/lib/sim/heroDemo";
import { evaluateDispatchAssignment } from "@/lib/agents/dynamicDispatchAgent";
import { HERO_DRIVER_ID } from "@/lib/domain/seed";

// Integration tests against a real Postgres. They run when
// NEXUS_TEST_DATABASE_URL points at a database the suite may wipe (CI
// provides one); locally they are skipped unless you set it.
const url = process.env.NEXUS_TEST_DATABASE_URL;

describe.skipIf(!url)("PostgresStateRepository (integration)", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 2 });
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await runMigrations(pool);
  });

  afterAll(async () => {
    setRepository(new InMemoryStateRepository());
    await pool.end();
  });

  it("applies migrations once and skips them on re-run", async () => {
    const again = await runMigrations(pool);
    expect(again.applied).toEqual([]);
    expect(again.skipped).toContain("0001_init.sql");
  });

  it("seeds the demo set into an empty database on first load", async () => {
    const repo = new PostgresStateRepository(pool);
    expect(await repo.hasData()).toBe(false);
    const state = await repo.load();
    expect(state.shipments.size).toBe(63);
    expect(await repo.hasData()).toBe(true);
    const rows = await pool.query<{ n: string }>("SELECT count(*)::text AS n FROM shipments");
    expect(Number(rows.rows[0].n)).toBe(63);
    const hero = await pool.query<{ status: string; driver_id: string }>(
      "SELECT status, driver_id FROM shipments WHERE id = $1",
      [HERO_SHIPMENT_ID]
    );
    expect(hero.rows[0]).toEqual({ status: "IN_TRANSIT", driver_id: HERO_DRIVER_ID });
    // The in-memory and Postgres backends start from the identical snapshot.
    expect(serializeState(state)).toEqual(serializeState(new InMemoryStateRepository().getState()));
  });

  it("runs the hero demo to the same decision and persists it losslessly", async () => {
    const repo = setRepository(new PostgresStateRepository(pool));
    await loadState();
    const result = await runHeroDemo();
    expect(result.run?.status).toBe("COMPLETED");
    expect(result.run?.selectedActionType).toBe("APPOINTMENT_RESCHEDULE");
    expect(result.run?.autonomyLevel).toBe("LOW_RISK_AUTONOMOUS");
    await persistState();

    const fresh = new PostgresStateRepository(pool);
    const reloaded = await fresh.load();
    expect(serializeState(reloaded)).toEqual(serializeState(repo.getState()));
    expect(reloaded.shipments.get(HERO_SHIPMENT_ID)?.appointment?.status).toBe("RESCHEDULED");
    expect(reloaded.auditLog.map((a) => a.action)).toContain("RESCHEDULE_APPOINTMENT");

    const audit = await pool.query<{ n: string }>("SELECT count(*)::text AS n FROM audit_log");
    expect(Number(audit.rows[0].n)).toBe(reloaded.auditLog.length);
  });

  it("persists incrementally: a second mutation adds only the new rows and deletes cleared keys", async () => {
    const repo = setRepository(new PostgresStateRepository(pool));
    await loadState();
    const before = getState().auditLog.length;
    getState().drivers.get(HERO_DRIVER_ID)!.status = "DELAYED";
    const { run } = evaluateDispatchAssignment(HERO_SHIPMENT_ID);
    expect(run?.status).toBe("AWAITING_APPROVAL");
    await persistState();
    const proposals = await pool.query<{ n: string }>("SELECT count(*)::text AS n FROM dispatch_proposals");
    expect(Number(proposals.rows[0].n)).toBe(1);

    getState().pendingDispatchProposals.delete(run!.id);
    await persistState();
    const cleared = await pool.query<{ n: string }>("SELECT count(*)::text AS n FROM dispatch_proposals");
    expect(Number(cleared.rows[0].n)).toBe(0);

    const audit = await pool.query<{ n: string }>("SELECT count(*)::text AS n FROM audit_log");
    expect(Number(audit.rows[0].n)).toBe(getState().auditLog.length);
    expect(getState().auditLog.length).toBeGreaterThan(before);
    void repo;
  });

  it("reset + persist returns the database to the seeded demo set", async () => {
    setRepository(new PostgresStateRepository(pool));
    await loadState();
    resetState();
    await persistState();
    const fresh = await new PostgresStateRepository(pool).load();
    expect(serializeState(fresh)).toEqual(serializeState(new InMemoryStateRepository().getState()));
    const audit = await pool.query<{ n: string }>("SELECT count(*)::text AS n FROM audit_log");
    expect(Number(audit.rows[0].n)).toBe(0);
  });

  it("seed loader refuses to overwrite without --force and reproduces the demo set with it", async () => {
    await expect(seedDatabase(pool)).rejects.toThrow(/--force/);
    const summary = await seedDatabase(pool, { force: true });
    expect(summary).toMatchObject({ shipments: 63, drivers: 10, vehicles: 14, facilities: 5, routes: 63, policies: 5 });
    const fresh = await new PostgresStateRepository(pool).load();
    expect(serializeState(fresh)).toEqual(serializeState(new InMemoryStateRepository().getState()));
  });
});
