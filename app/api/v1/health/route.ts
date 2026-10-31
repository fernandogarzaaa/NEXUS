import { selectedBackend } from "@/lib/domain/store";
import { parseApiKeys, type ApiAuthEnv } from "@/lib/apiAuth";

export const dynamic = "force-dynamic";

/** Unauthenticated liveness check. Reports configuration, never data. */
export async function GET(): Promise<Response> {
  let apiKeys: number | "invalid" = 0;
  try {
    apiKeys = parseApiKeys(process.env as ApiAuthEnv).length;
  } catch {
    apiKeys = "invalid";
  }
  return Response.json(
    { status: "ok", backend: selectedBackend(), apiKeysConfigured: apiKeys, version: process.env.npm_package_version ?? null },
    { headers: { "cache-control": "no-store" } }
  );
}
