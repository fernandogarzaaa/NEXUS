import { z } from "zod";
import { safeEqual } from "./auth";

/**
 * Scoped API-key auth for the public read API (app/api/v1).
 *
 * NEXUS_API_KEYS  JSON array of keys. Each key maps to a real subject
 *                 (person or service), a tenant, roles and scopes:
 *                 [{"id":"ops-dashboard","secret":"<>=16 chars>","subject":"ops@example.com",
 *                   "tenantId":"senor-pilot","roles":["viewer"],"scopes":["read:*"]}]
 * NEXUS_TENANT_ID The tenant this deployment serves (default "demo"). A key
 *                 for another tenant is refused, so one deployment can never
 *                 serve another tenant's data by accident. Row-level
 *                 multi-tenancy inside one database is NOT built.
 *
 * This is deliberately separate from the shared demo token in lib/auth.ts,
 * which only gates the human UI and is not production auth.
 */

export const API_SCOPES = [
  "read:summary",
  "read:shipments",
  "read:drivers",
  "read:vehicles",
  "read:facilities",
  "read:exceptions",
  "read:approvals",
  "read:policies",
  "read:agent-runs",
  "read:audit",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const API_ROLES = ["viewer", "operator", "admin"] as const;
export type ApiRole = (typeof API_ROLES)[number];

const apiKeySchema = z
  .object({
    id: z.string().min(1),
    secret: z.string().min(16),
    subject: z.string().min(1),
    tenantId: z.string().min(1),
    roles: z.array(z.enum(API_ROLES)).min(1),
    scopes: z.array(z.union([z.enum(API_SCOPES), z.literal("read:*")])).min(1),
  })
  .strict();

export type ApiKey = z.infer<typeof apiKeySchema>;

export interface ApiPrincipal {
  keyId: string;
  subject: string;
  tenantId: string;
  roles: ApiRole[];
  scopes: ApiKey["scopes"];
}

export type ApiAuthEnv = { NEXUS_API_KEYS?: string; NEXUS_TENANT_ID?: string };

export function configuredTenant(env: ApiAuthEnv): string {
  return (env.NEXUS_TENANT_ID ?? "demo").trim() || "demo";
}

export function parseApiKeys(env: ApiAuthEnv): ApiKey[] {
  const raw = (env.NEXUS_API_KEYS ?? "").trim();
  if (!raw) return [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("NEXUS_API_KEYS is not valid JSON");
  }
  const parsed = z.array(apiKeySchema).safeParse(json);
  if (!parsed.success) {
    throw new Error(`NEXUS_API_KEYS is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const ids = new Set<string>();
  for (const k of parsed.data) {
    if (ids.has(k.id)) throw new Error(`NEXUS_API_KEYS has a duplicate key id "${k.id}"`);
    ids.add(k.id);
  }
  return parsed.data;
}

export type ApiAuthResult =
  | { ok: true; principal: ApiPrincipal }
  | { ok: false; status: 401 | 403 | 503; code: "no_keys_configured" | "missing_credentials" | "invalid_key" | "wrong_tenant" | "insufficient_scope"; message: string; keyId?: string };

export function hasScope(principal: Pick<ApiPrincipal, "scopes">, scope: ApiScope): boolean {
  return principal.scopes.includes("read:*") || principal.scopes.includes(scope);
}

/**
 * Authenticate `Authorization: Bearer <keyId>.<secret>` and authorise the
 * requested scope. Secrets are compared in constant time; an unknown key id
 * and a wrong secret are indistinguishable to the caller.
 */
export function authenticateApiRequest(env: ApiAuthEnv, authorization: string | null | undefined, scope: ApiScope): ApiAuthResult {
  const keys = parseApiKeys(env);
  if (keys.length === 0) {
    return { ok: false, status: 503, code: "no_keys_configured", message: "The API is disabled: NEXUS_API_KEYS is not configured." };
  }
  const header = (authorization ?? "").trim();
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    return { ok: false, status: 401, code: "missing_credentials", message: "Send `Authorization: Bearer <keyId>.<secret>`." };
  }
  const dot = match[1].indexOf(".");
  const keyId = dot > 0 ? match[1].slice(0, dot) : "";
  const secret = dot > 0 ? match[1].slice(dot + 1) : "";
  const key = keys.find((k) => k.id === keyId);
  // Always run the comparison so timing does not reveal whether the id exists.
  const valid = safeEqual(secret, key?.secret ?? "\u0000".repeat(Math.max(secret.length, 1)));
  if (!key || !valid) {
    return { ok: false, status: 401, code: "invalid_key", message: "Invalid API key." };
  }
  const tenant = configuredTenant(env);
  if (key.tenantId !== tenant) {
    return { ok: false, status: 403, code: "wrong_tenant", message: `This deployment serves tenant "${tenant}"; the key belongs to another tenant.`, keyId: key.id };
  }
  const principal: ApiPrincipal = { keyId: key.id, subject: key.subject, tenantId: key.tenantId, roles: key.roles, scopes: key.scopes };
  if (!hasScope(principal, scope)) {
    return { ok: false, status: 403, code: "insufficient_scope", message: `This key lacks the "${scope}" scope.`, keyId: key.id };
  }
  return { ok: true, principal };
}
