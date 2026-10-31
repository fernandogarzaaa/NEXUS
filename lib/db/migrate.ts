import fs from "node:fs";
import path from "node:path";
import type { Pool } from "pg";

// Forward-only SQL migrations from db/migrations/*.sql, applied in file-name
// order and recorded in nexus_migrations. Each file runs inside one
// transaction. Re-running is a no-op for files already recorded.

export const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export function listMigrationFiles(dir: string = MIGRATIONS_DIR): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export async function runMigrations(pool: Pool, dir: string = MIGRATIONS_DIR): Promise<MigrationResult> {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS nexus_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
  );
  const done = new Set(
    (await pool.query<{ name: string }>("SELECT name FROM nexus_migrations")).rows.map((r) => r.name)
  );
  const result: MigrationResult = { applied: [], skipped: [] };
  for (const file of listMigrationFiles(dir)) {
    if (done.has(file)) {
      result.skipped.push(file);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO nexus_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      result.applied.push(file);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      client.release();
    }
  }
  return result;
}
