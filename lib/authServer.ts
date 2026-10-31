import { cookies } from "next/headers";
import {
  ForbiddenError,
  SESSION_COOKIE,
  UI_ROLES,
  UnauthorizedError,
  decide,
  uiTenant,
  usersMode,
  verifyUserSession,
  type AuthEnv,
  type UiRole,
} from "./auth";

/**
 * Who is acting in the UI. In pilot mode (NEXUS_USERS) this is a named user
 * with roles; in token or open demo mode it is an explicitly unnamed
 * principal with every role, so the demo keeps working but nothing claims a
 * real person did it.
 */
export interface UiPrincipal {
  mode: "users" | "token" | "open";
  named: boolean;
  username: string | null;
  displayName: string;
  tenantId: string;
  roles: UiRole[];
}

/** The string recorded as the human actor (audit, approval resolvedBy). */
export function actorLabel(p: UiPrincipal): string {
  return p.named ? `${p.displayName} (${p.username})` : p.displayName;
}

async function sessionCookie(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/** The current principal, or null when the request is not allowed in at all. */
export async function currentPrincipal(): Promise<UiPrincipal | null> {
  const env = process.env as AuthEnv;
  if (usersMode(env)) {
    const user = await verifyUserSession(env, await sessionCookie());
    if (!user) return null;
    return { mode: "users", named: true, username: user.username, displayName: user.displayName, tenantId: user.tenantId, roles: user.roles };
  }
  const needsCookie = Boolean((env.NEXUS_ACCESS_TOKEN ?? "").trim());
  const decision = await decide(env, needsCookie ? await sessionCookie() : undefined);
  if (decision !== "allow") return null;
  return {
    mode: needsCookie ? "token" : "open",
    named: false,
    username: null,
    displayName: needsCookie ? "Shared access token (unnamed user)" : "Unauthenticated demo user",
    tenantId: uiTenant(env),
    roles: [...UI_ROLES],
  };
}

/**
 * Throws UnauthorizedError unless the current request may run Server Actions,
 * and ForbiddenError when it lacks every one of `roles`. Returns the principal.
 */
export async function assertAuthorized(...roles: UiRole[]): Promise<UiPrincipal> {
  const env = process.env as AuthEnv;
  const principal = await currentPrincipal();
  if (!principal) {
    if (usersMode(env)) throw new UnauthorizedError("login_required");
    const needsCookie = Boolean((env.NEXUS_ACCESS_TOKEN ?? "").trim());
    const decision = await decide(env, needsCookie ? await sessionCookie() : undefined);
    throw new UnauthorizedError(decision === "allow" ? "login_required" : decision);
  }
  if (roles.length > 0 && !principal.roles.some((r) => roles.includes(r))) {
    throw new ForbiddenError(roles, actorLabel(principal));
  }
  return principal;
}

/** True when the current request may see app pages. */
export async function canViewPages(): Promise<boolean> {
  const env = process.env as AuthEnv;
  if (!usersMode(env) && !(env.NEXUS_ACCESS_TOKEN ?? "").trim()) return true;
  return (await decide(env, await sessionCookie())) !== "login_required";
}
