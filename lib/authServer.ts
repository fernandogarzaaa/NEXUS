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
