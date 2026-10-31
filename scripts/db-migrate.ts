// Apply db/migrations/*.sql to DATABASE_URL. Usage: npm run db:migrate
import { getPool } from "../lib/db/pg";
import { runMigrations } from "../lib/db/migrate";

async function main() {
  const pool = getPool();
  try {
    const result = await runMigrations(pool);
    for (const f of result.applied) console.log(`applied  ${f}`);
    for (const f of result.skipped) console.log(`skipped  ${f} (already applied)`);
    if (result.applied.length === 0) console.log("Database schema is up to date.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
