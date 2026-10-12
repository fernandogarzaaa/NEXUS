"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_MAX_AGE_S, passwordMatches, sessionValue } from "./auth";

export type LoginState = { error?: string };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const attempt = String(formData.get("token") ?? "");
  const env = process.env;
  if (!passwordMatches(env, attempt)) {
    return { error: "Wrong access token." };
  }
  (await cookies()).set(SESSION_COOKIE, await sessionValue(attempt), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
