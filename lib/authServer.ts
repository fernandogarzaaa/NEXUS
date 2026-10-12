import { cookies } from "next/headers";
import { SESSION_COOKIE, UnauthorizedError, decide } from "./auth";

/** Throws UnauthorizedError unless the current request may run Server Actions. */
export async function assertAuthorized(): Promise<void> {
  const env = process.env;
  const needsCookie = Boolean((env.NEXUS_ACCESS_TOKEN ?? "").trim());
  const cookie = needsCookie ? (await cookies()).get(SESSION_COOKIE)?.value : undefined;
  const decision = await decide(env, cookie);
  if (decision !== "allow") throw new UnauthorizedError(decision);
}

/** True when the current request may see app pages (false only when a token
 * is configured and the session cookie is missing/invalid). Used by the root
 * layout so /login does not render the sidebar's live counts to anonymous users. */
export async function canViewPages(): Promise<boolean> {
  const env = process.env;
  if (!(env.NEXUS_ACCESS_TOKEN ?? "").trim()) return true;
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  return (await decide(env, cookie)) !== "login_required";
}
