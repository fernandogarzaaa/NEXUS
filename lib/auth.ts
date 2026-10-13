/**
 * Minimal shared-secret auth gate for NEXUS.
 *
 * NEXUS_ACCESS_TOKEN   when set, every page and Server Action requires a
 *                      session cookie obtained by entering this token at /login.
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
  NODE_ENV?: string;
};

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
        ? "Not signed in: open /login and enter the NEXUS access token."
        : "NEXUS_ACCESS_TOKEN is not set; actions are disabled in production " +
            "(set a token, or NEXUS_ALLOW_UNAUTHENTICATED=1 for a throwaway demo).",
    );
    this.name = "UnauthorizedError";
    this.reason = reason;
  }
}
