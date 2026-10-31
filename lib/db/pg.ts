import { Pool } from "pg";

// One shared connection pool per process. Cached on globalThis so Next.js
// dev-mode module reloads do not leak pools. Only constructed when the
// Postgres backend is actually selected (see lib/domain/store.ts).

declare global {
  var __NEXUS_PG_POOL__: Pool | undefined;
}

export function getPool(connectionString: string | undefined = process.env.DATABASE_URL): Pool {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set; it is required when NEXUS_STATE_BACKEND=postgres");
  }
  if (!globalThis.__NEXUS_PG_POOL__) {
    globalThis.__NEXUS_PG_POOL__ = new Pool({
      connectionString,
      // DATABASE_SSL=1 turns on TLS with certificate verification against the
      // system trust store. Hosted Postgres providers that need a custom CA
      // should put it in NODE_EXTRA_CA_CERTS rather than disable verification.
      ssl: process.env.DATABASE_SSL === "1" ? true : undefined,
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    });
  }
  return globalThis.__NEXUS_PG_POOL__;
}
