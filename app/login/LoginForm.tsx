"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "@/lib/authActions";

export default function LoginForm({ named = false }: { named?: boolean }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <form action={formAction} className="flex flex-col gap-3 w-80">
      {named ? (
        <>
          <label htmlFor="username" className="text-sm">
            Username
          </label>
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            required
            className="rounded border px-3 py-2"
            style={{ borderColor: "var(--border)" }}
          />
          <label htmlFor="password" className="text-sm">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="rounded border px-3 py-2"
            style={{ borderColor: "var(--border)" }}
          />
        </>
      ) : (
        <>
          <label htmlFor="token" className="text-sm">
            Access token
          </label>
          <input
            id="token"
            name="token"
            type="password"
            autoComplete="current-password"
            required
            className="rounded border px-3 py-2"
            style={{ borderColor: "var(--border)" }}
          />
        </>
      )}
      {state.error ? (
        <p role="alert" className="text-sm" style={{ color: "var(--danger, #d33)" }}>
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded px-3 py-2 text-white"
        style={{ background: "var(--accent)" }}
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
