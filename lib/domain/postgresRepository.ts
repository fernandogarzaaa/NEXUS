import type { Pool, PoolClient } from "pg";
import { DEMO_SEED } from "./seed";
import { buildState, deserializeState, serializeState, type NexusState, type StateSnapshot } from "./state";
import type { StateRepository } from "./repository";

// ---------------------------------------------------------------------------
// Postgres-backed StateRepository. The agents and tools stay synchronous and
// keep mutating one in-process NexusState; this repository hydrates that
// working set from Postgres on first load() and flushes it back on
// persist(). Keyed entities (Maps) are upserted in full and rows no longer
// present are deleted; append-only lists are written from a per-table
// watermark so the audit log and timelines cost O(new rows) per persist.
//
// Deployment model this supports: one NEXUS server process per database
// (single writer). Durability across restarts and real SQL access are the
// goals; multi-instance coordination is not claimed and not built.
// ---------------------------------------------------------------------------

type SnapshotListKey = "agentSteps" | "agentActions" | "communications" | "auditLog";
type SnapshotKeyedKey =
  | "facilities"
  | "vehicles"
  | "drivers"
  | "shipments"
  | "routes"
  | "exceptions"
  | "policies"
  | "agentRuns"
  | "approvals"
  | "pendingDispatchProposals";

interface KeyedSpec {
  table: string;
  keyColumn: string;
  snapshotKey: SnapshotKeyedKey;
  keyOf: (row: Record<string, unknown>) => string;
}

interface ListSpec {
  table: string;
  snapshotKey: SnapshotListKey;
}

const idOf = (row: Record<string, unknown>) => String(row.id);

const KEYED: KeyedSpec[] = [
  { table: "facilities", keyColumn: "id", snapshotKey: "facilities", keyOf: idOf },
  { table: "vehicles", keyColumn: "id", snapshotKey: "vehicles", keyOf: idOf },
  { table: "drivers", keyColumn: "id", snapshotKey: "drivers", keyOf: idOf },
  { table: "shipments", keyColumn: "id", snapshotKey: "shipments", keyOf: idOf },
  { table: "routes", keyColumn: "id", snapshotKey: "routes", keyOf: idOf },
  { table: "exceptions", keyColumn: "id", snapshotKey: "exceptions", keyOf: idOf },
  { table: "policies", keyColumn: "action_type", snapshotKey: "policies", keyOf: (r) => String(r.actionType) },
  { table: "agent_runs", keyColumn: "id", snapshotKey: "agentRuns", keyOf: idOf },
  { table: "approvals", keyColumn: "id", snapshotKey: "approvals", keyOf: idOf },
  {
    table: "dispatch_proposals",
    keyColumn: "agent_run_id",
    snapshotKey: "pendingDispatchProposals",
    keyOf: (r) => String(r.agentRunId),
  },
];

const LISTS: ListSpec[] = [
  { table: "agent_steps", snapshotKey: "agentSteps" },
  { table: "agent_actions", snapshotKey: "agentActions" },
  { table: "communications", snapshotKey: "communications" },
  { table: "audit_log", snapshotKey: "auditLog" },
];

const META_KEYS = ["seed", "demoRunning", "demoCompletedAt", "seq"] as const;

const CHUNK = 200;

async function upsertRows(
  client: PoolClient,
  table: string,
  keyColumn: string,
  rows: Array<[string, unknown]>,
  dataColumn = "data"
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const placeholders = chunk.map((_, j) => `($${j * 2 + 1}, $${j * 2 + 2}::jsonb)`).join(", ");
    const values = chunk.flatMap(([key, data]) => [key, JSON.stringify(data)]);
    await client.query(
      `INSERT INTO ${table} (${keyColumn}, ${dataColumn}) VALUES ${placeholders}
       ON CONFLICT (${keyColumn}) DO UPDATE SET ${dataColumn} = EXCLUDED.${dataColumn}`,
      values
    );
  }
}

export class PostgresStateRepository implements StateRepository {
  readonly backend = "postgres" as const;
  private state: NexusState | null = null;
  private fullRewrite = false;
  private watermarks: Record<SnapshotListKey, number> = {
    agentSteps: 0,
    agentActions: 0,
    communications: 0,
    auditLog: 0,
  };
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly pool: Pool) {}

  getState(): NexusState {
    if (!this.state) {
      throw new Error("PostgresStateRepository: working set not loaded; await loadState() first");
    }
    return this.state;
  }

  resetState(seed: number = DEMO_SEED): NexusState {
    this.state = buildState(seed);
    this.fullRewrite = true;
    return this.state;
  }

  /** True when the database holds a NEXUS working set (seeded or persisted). */
  async hasData(): Promise<boolean> {
    await this.assertMigrated();
    const res = await this.pool.query("SELECT 1 FROM nexus_meta WHERE key = 'seed'");
    return res.rowCount === 1;
  }

  /**
   * Hydrate once per process. An empty (migrated) database is seeded with
   * the deterministic demo set on first load, so a fresh deployment behaves
   * exactly like the in-memory backend did.
   */
  async load(): Promise<NexusState> {
    if (this.state) return this.state;
    return this.enqueue(async () => {
      if (this.state) return this.state;
      if (!(await this.hasData())) {
        this.state = buildState();
        this.fullRewrite = true;
        await this.flush();
        return this.state;
      }
      this.state = deserializeState(await this.readSnapshot());
      for (const list of LISTS) this.watermarks[list.snapshotKey] = this.state[list.snapshotKey].length;
      return this.state;
    });
  }

  /** Re-read from the database, discarding the in-process working set. */
  async reload(): Promise<NexusState> {
    this.state = null;
    return this.load();
  }

  async persist(): Promise<void> {
    if (!this.state) return;
    await this.enqueue(() => this.flush());
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async assertMigrated(): Promise<void> {
    const res = await this.pool.query<{ ok: string | null }>("SELECT to_regclass('public.nexus_meta')::text AS ok");
    if (!res.rows[0]?.ok) {
      throw new Error("NEXUS tables are missing; run `npm run db:migrate` against DATABASE_URL first");
    }
  }

  private async readSnapshot(): Promise<StateSnapshot> {
    const snapshot: Partial<StateSnapshot> = {};
    for (const spec of KEYED) {
      const res = await this.pool.query<{ data: unknown }>(`SELECT data FROM ${spec.table} ORDER BY ord`);
      (snapshot as Record<string, unknown>)[spec.snapshotKey] = res.rows.map((r) => r.data);
    }
    for (const spec of LISTS) {
      const res = await this.pool.query<{ data: unknown }>(`SELECT data FROM ${spec.table} ORDER BY ord`);
      (snapshot as Record<string, unknown>)[spec.snapshotKey] = res.rows.map((r) => r.data);
    }
    const meta = await this.pool.query<{ key: string; value: unknown }>("SELECT key, value FROM nexus_meta");
    const metaMap = new Map(meta.rows.map((r) => [r.key, r.value]));
    snapshot.seed = Number(metaMap.get("seed") ?? DEMO_SEED);
    snapshot.demoRunning = Boolean(metaMap.get("demoRunning") ?? false);
    snapshot.demoCompletedAt = (metaMap.get("demoCompletedAt") as string | null) ?? null;
    snapshot.seq = Number(metaMap.get("seq") ?? 0);
    return snapshot as StateSnapshot;
  }

  private async flush(): Promise<void> {
    const state = this.state;
    if (!state) return;
    await this.assertMigrated();
    const snapshot = serializeState(state);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (this.fullRewrite) {
        const tables = [...KEYED.map((k) => k.table), ...LISTS.map((l) => l.table), "nexus_meta"];
        await client.query(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY`);
        for (const list of LISTS) this.watermarks[list.snapshotKey] = 0;
      }
      for (const spec of KEYED) {
        const rows = snapshot[spec.snapshotKey] as Array<Record<string, unknown>>;
        const keyed: Array<[string, unknown]> = rows.map((row) => [spec.keyOf(row), row]);
        await upsertRows(client, spec.table, spec.keyColumn, keyed);
        await client.query(`DELETE FROM ${spec.table} WHERE NOT (${spec.keyColumn} = ANY($1::text[]))`, [
          keyed.map(([k]) => k),
        ]);
      }
      for (const spec of LISTS) {
        const rows = snapshot[spec.snapshotKey] as unknown as Array<Record<string, unknown>>;
        const from = Math.min(this.watermarks[spec.snapshotKey], rows.length);
        const fresh: Array<[string, unknown]> = rows.slice(from).map((row) => [String(row.id), row]);
        await upsertRows(client, spec.table, "id", fresh);
      }
      const metaRows: Array<[string, unknown]> = META_KEYS.map((k) => [k, snapshot[k]]);
      await upsertRows(client, "nexus_meta", "key", metaRows, "value");
      await client.query("COMMIT");
      for (const spec of LISTS) this.watermarks[spec.snapshotKey] = snapshot[spec.snapshotKey].length;
      this.fullRewrite = false;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
