// Load the deterministic demo set into DATABASE_URL.
// Usage: npm run db:seed [-- --force] [-- --seed 20260817]
import { getPool } from "../lib/db/pg";
import { seedDatabase } from "../lib/db/seed";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const pool = getPool();
  try {
    const seedArg = arg("--seed");
    const summary = await seedDatabase(pool, {
      force: process.argv.includes("--force"),
      seed: seedArg ? Number(seedArg) : undefined,
    });
    console.log(`Seeded demo set (seed ${summary.seed}):`);
    console.log(
      `  ${summary.facilities} facilities, ${summary.vehicles} vehicles, ${summary.drivers} drivers, ` +
        `${summary.shipments} shipments, ${summary.routes} routes, ${summary.policies} policies`
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
