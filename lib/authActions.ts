"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  findUser,
  passwordMatches,
  sessionValue,
  signUserSession,
  uiTenant,
  usersMode,
  type AuthEnv,
} from "./auth";
import { verifyPassword } from "./passwords";

export type LoginState = { error?: string };

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_MAX_AGE_S,
};

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const env = process.env as AuthEnv;
  if (usersMode(env)) {
    const username = String(formData.get("username") ?? "");
    const password = String(formData.get("password") ?? "");
    const user = findUser(env, username);
    // verifyPassword runs scrypt even for unknown users, so timing does not reveal them.
    const ok = verifyPassword(password, user?.passwordHash);
    if (!user || !ok || user.tenantId !== uiTenant(env)) {
      return { error: "Wrong username or password." };
    }
    (await cookies()).set(SESSION_COOKIE, await signUserSession(env, user), COOKIE_OPTIONS);
    redirect("/");
  }

  const attempt = String(formData.get("token") ?? "");
  if (!passwordMatches(env, attempt)) {
    return { error: "Wrong access token." };
  }
  (await cookies()).set(SESSION_COOKIE, await sessionValue(attempt), COOKIE_OPTIONS);
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
