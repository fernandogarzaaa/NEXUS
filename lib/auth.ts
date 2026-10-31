import { z } from "zod";

/**
 * Auth gate for the NEXUS UI. Three modes, in order of precedence:
 *
 * NEXUS_USERS          (pilot mode) JSON array of named users, each with a
 *                      scrypt password hash, a tenant and roles. Requires
 *                      NEXUS_SESSION_SECRET (>= 32 chars). Sessions are an
 *                      HMAC-signed {user, tenant, expiry, password fingerprint}
 *                      cookie, so approvals and edits are attributed to a real
 *                      person and gated by role. Users whose tenant is not
 *                      NEXUS_TENANT_ID (default "demo") cannot sign in.
 * NEXUS_ACCESS_TOKEN   (demo mode) when set, every page and Server Action requires a
 *                      session cookie obtained by entering this token at /login.
 *                      This is a shared secret, not production auth: everyone
 *                      who knows it is the same anonymous user.
 * NEXUS_ALLOW_UNAUTHENTICATED=1
 *                      explicit opt-out for a public, throwaway demo. Without a
 *                      token and without this flag, Server Actions (approve,
 *                      reject, reset, run scenario, policy edits) are refused in
 *                      production builds; `next dev` and tests stay open.
 *
 * This module is pure (no Next.js imports) so it can run in proxy.ts, Server
 * Actions and unit tests alike.
 */

export const SESSION_COOKIE = "nexus_session";
export const SESSION_MAX_AGE_S = 60 * 60 * 12;

export type AuthEnv = {
  NEXUS_ACCESS_TOKEN?: string;
  NEXUS_ALLOW_UNAUTHENTICATED?: string;
  NEXUS_USERS?: string;
  NEXUS_SESSION_SECRET?: string;
  NEXUS_TENANT_ID?: string;
  NODE_ENV?: string;
};

// -- Named users (pilot mode) --------------------------------------------------

export const UI_ROLES = ["viewer", "operator", "admin"] as const;
export type UiRole = (typeof UI_ROLES)[number];

const userSchema = z
  .object({
    username: z.string().regex(/^[a-z0-9._@-]{2,64}$/i, "username: 2-64 chars of letters, digits, . _ @ -"),
    displayName: z.string().min(1).max(100),
    passwordHash: z.string().startsWith("scrypt$"),
    tenantId: z.string().min(1),
    roles: z.array(z.enum(UI_ROLES)).min(1),
  })
  .strict();
export type UiUser = z.infer<typeof userSchema>;

export function parseUsers(env: AuthEnv): UiUser[] {
  const raw = (env.NEXUS_USERS ?? "").trim();
  if (!raw) return [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("NEXUS_USERS is not valid JSON");
  }
  const parsed = z.array(userSchema).safeParse(json);
  if (!parsed.success) {
    throw new Error(`NEXUS_USERS is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const seen = new Set<string>();
  for (const u of parsed.data) {
    const key = u.username.toLowerCase();
    if (seen.has(key)) throw new Error(`NEXUS_USERS has a duplicate username "${u.username}"`);
    seen.add(key);
  }
  return parsed.data;
}

export function usersMode(env: AuthEnv): boolean {
  return (env.NEXUS_USERS ?? "").trim().length > 0;
}

export function uiTenant(env: AuthEnv): string {
  return (env.NEXUS_TENANT_ID ?? "demo").trim() || "demo";
}

function sessionSecret(env: AuthEnv): string {
  const secret = (env.NEXUS_SESSION_SECRET ?? "").trim();
  if (secret.length < 32) throw new Error("NEXUS_SESSION_SECRET must be set (at least 32 characters) when NEXUS_USERS is configured");
  return secret;
}

export function findUser(env: AuthEnv, username: string): UiUser | undefined {
  const key = username.trim().toLowerCase();
  return parseUsers(env).find((u) => u.username.toLowerCase() === key);
}

async function hmacHex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function b64url(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): string {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0)));
}

interface UserSessionPayload {
  u: string;
  t: string;
  exp: number;
  /** Password fingerprint: changing a user's password ends their sessions. */
  pf: string;
}

async function passwordFingerprint(env: AuthEnv, user: UiUser): Promise<string> {
  return (await hmacHex(sessionSecret(env), `pf:${user.passwordHash}`)).slice(0, 16);
}

export async function signUserSession(env: AuthEnv, user: UiUser, nowS: number = Math.floor(Date.now() / 1000)): Promise<string> {
  const payload: UserSessionPayload = { u: user.username, t: user.tenantId, exp: nowS + SESSION_MAX_AGE_S, pf: await passwordFingerprint(env, user) };
  const body = b64url(JSON.stringify(payload));
  return `u1.${body}.${await hmacHex(sessionSecret(env), `u1.${body}`)}`;
}

/** The signed-in user for a cookie, or null if invalid, expired, revoked or for another tenant. */
export async function verifyUserSession(env: AuthEnv, cookie: string | undefined, nowS: number = Math.floor(Date.now() / 1000)): Promise<UiUser | null> {
  if (!cookie || !cookie.startsWith("u1.")) return null;
  const [, body, sig] = cookie.split(".");
  if (!body || !sig) return null;
  if (!safeEqual(sig, await hmacHex(sessionSecret(env), `u1.${body}`))) return null;
  let payload: UserSessionPayload;
  try {
    payload = JSON.parse(unb64url(body)) as UserSessionPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < nowS) return null;
  const user = findUser(env, String(payload.u));
  if (!user || user.tenantId !== payload.t || user.tenantId !== uiTenant(env)) return null;
  if (!safeEqual(String(payload.pf), await passwordFingerprint(env, user))) return null;
  return user;
}

export type AuthDecision = "allow" | "login_required" | "not_configured";

export function configuredToken(env: AuthEnv): string {
  return (env.NEXUS_ACCESS_TOKEN ?? "").trim();
}

/** Constant-time string comparison (length leak only). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Cookie value for a valid session: HMAC-SHA256(token, "nexus-session-v1"), hex. */
export async function sessionValue(token: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(token),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("nexus-session-v1"));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function isValidSession(env: AuthEnv, cookie: string | undefined): Promise<boolean> {
  const token = configuredToken(env);
  if (!token || !cookie) return false;
  return safeEqual(cookie, await sessionValue(token));
}

export function passwordMatches(env: AuthEnv, attempt: string): boolean {
  const token = configuredToken(env);
  return token.length > 0 && safeEqual(attempt, token);
}

/**
 * Decide whether a request/action may proceed.
 * - token configured: allow only with a valid session cookie
 * - no token: allow in dev/test, or when NEXUS_ALLOW_UNAUTHENTICATED=1;
 *   otherwise (production) refuse as not_configured.
 */
export async function decide(env: AuthEnv, cookie: string | undefined): Promise<AuthDecision> {
  if (usersMode(env)) {
    return (await verifyUserSession(env, cookie)) ? "allow" : "login_required";
  }
  if (configuredToken(env)) {
    return (await isValidSession(env, cookie)) ? "allow" : "login_required";
  }
  if (env.NEXUS_ALLOW_UNAUTHENTICATED === "1") return "allow";
  if (env.NODE_ENV === "production") return "not_configured";
  return "allow";
}

/**
 * True when no request can run Server Actions because the deployment is a
 * production build with neither a token nor the explicit opt-out. Pages still
 * render, so the UI must say it is read-only instead of letting every button
 * fail with a generic error (production builds redact the server message).
 */
export function actionsDisabledByConfig(env: AuthEnv): boolean {
  return (
    !usersMode(env) &&
    !configuredToken(env) &&
    env.NEXUS_ALLOW_UNAUTHENTICATED !== "1" &&
    env.NODE_ENV === "production"
  );
}

export class UnauthorizedError extends Error {
  readonly reason: Exclude<AuthDecision, "allow">;

  constructor(reason: Exclude<AuthDecision, "allow">) {
    super(
      reason === "login_required"
        ? "Not signed in: open /login and sign in."
        : "NEXUS_ACCESS_TOKEN is not set; actions are disabled in production " +
            "(configure NEXUS_USERS for named users, set a token, or NEXUS_ALLOW_UNAUTHENTICATED=1 for a throwaway demo).",
    );
    this.name = "UnauthorizedError";
    this.reason = reason;
  }
}

export class ForbiddenError extends Error {
  constructor(public readonly needed: UiRole[], who: string) {
    super(`${who} lacks the role for this action (needs ${needed.join(" or ")}).`);
    this.name = "ForbiddenError";
  }
}
