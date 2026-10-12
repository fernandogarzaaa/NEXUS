import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_COOKIE,
  UnauthorizedError,
  configuredToken,
  decide,
  isValidSession,
  passwordMatches,
  safeEqual,
  sessionValue,
} from "@/lib/auth";

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined),
    set: (name: string, value: string) => cookieJar.set(name, value),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

describe("auth core", () => {
  it("reads and trims the configured token", () => {
    expect(configuredToken({})).toBe("");
    expect(configuredToken({ NEXUS_ACCESS_TOKEN: "  abc  " })).toBe("abc");
  });

  it("safeEqual compares exactly", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "ab")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
    expect(safeEqual("a", "b")).toBe(false);
    expect(safeEqual("ba", "bb")).toBe(false);
  });

  it("session value is a deterministic, token-bound HMAC", async () => {
    const a = await sessionValue("t1");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await sessionValue("t1")).toBe(a);
    expect(await sessionValue("t2")).not.toBe(a);
    // HMAC-SHA256(key="t1", msg="nexus-session-v1")
    const { createHmac } = await import("node:crypto");
    expect(a).toBe(createHmac("sha256", "t1").update("nexus-session-v1").digest("hex"));
  });

  it("validates sessions only against the configured token", async () => {
    const env = { NEXUS_ACCESS_TOKEN: "t1" };
    expect(await isValidSession(env, await sessionValue("t1"))).toBe(true);
    expect(await isValidSession(env, await sessionValue("t2"))).toBe(false);
    expect(await isValidSession(env, undefined)).toBe(false);
    expect(await isValidSession(env, "")).toBe(false);
    expect(await isValidSession({}, await sessionValue("x"))).toBe(false);
  });

  it("password check never accepts an empty configuration", () => {
    expect(passwordMatches({ NEXUS_ACCESS_TOKEN: "t1" }, "t1")).toBe(true);
    expect(passwordMatches({ NEXUS_ACCESS_TOKEN: "t1" }, "t2")).toBe(false);
    expect(passwordMatches({}, "")).toBe(false);
    expect(passwordMatches({ NEXUS_ACCESS_TOKEN: "   " }, "")).toBe(false);
  });

  it("decide(): token configured requires a valid cookie", async () => {
    const env = { NEXUS_ACCESS_TOKEN: "t1", NEXUS_ALLOW_UNAUTHENTICATED: "1", NODE_ENV: "development" };
    expect(await decide(env, undefined)).toBe("login_required");
    expect(await decide(env, "forged")).toBe("login_required");
    expect(await decide(env, await sessionValue("t1"))).toBe("allow");
  });

  it("decide(): no token is open in dev/test, closed in production unless opted in", async () => {
    expect(await decide({ NODE_ENV: "development" }, undefined)).toBe("allow");
    expect(await decide({ NODE_ENV: "test" }, undefined)).toBe("allow");
    expect(await decide({ NODE_ENV: "production" }, undefined)).toBe("not_configured");
    expect(await decide({ NODE_ENV: "production", NEXUS_ALLOW_UNAUTHENTICATED: "1" }, undefined)).toBe("allow");
    expect(await decide({ NODE_ENV: "production", NEXUS_ALLOW_UNAUTHENTICATED: "true" }, undefined)).toBe(
      "not_configured",
    );
  });

  it("UnauthorizedError carries the reason and a helpful message", () => {
    const e1 = new UnauthorizedError("login_required");
    expect(e1.reason).toBe("login_required");
    expect(e1.name).toBe("UnauthorizedError");
    expect(e1.message).toMatch(/\/login/);
    expect(new UnauthorizedError("not_configured").message).toMatch(/NEXUS_ACCESS_TOKEN/);
  });
});

describe("Server Actions are gated", () => {
  const saved = { ...process.env };
  beforeEach(() => cookieJar.clear());
  afterEach(() => {
    process.env = { ...saved };
  });

  it("refuses resetDemoAction without a session when a token is set", async () => {
    process.env.NEXUS_ACCESS_TOKEN = "t1";
    const { resetDemoAction } = await import("@/lib/actions");
    await expect(resetDemoAction()).rejects.toBeInstanceOf(UnauthorizedError);
    cookieJar.set(SESSION_COOKIE, "forged");
    await expect(resetDemoAction()).rejects.toThrow(/Not signed in/);
    cookieJar.set(SESSION_COOKIE, await sessionValue("t1"));
    await expect(resetDemoAction()).resolves.toBeUndefined();
  });

  it("refuses actions in production with no token", async () => {
    delete process.env.NEXUS_ACCESS_TOKEN;
    vi.stubEnv("NODE_ENV", "production");
    const { decideApprovalAction, updatePolicyAction } = await import("@/lib/actions");
    await expect(decideApprovalAction("x", true)).rejects.toThrow(/NEXUS_ACCESS_TOKEN is not set/);
    await expect(updatePolicyAction("REROUTE", "LOW_RISK_AUTONOMOUS", null)).rejects.toBeInstanceOf(UnauthorizedError);
    vi.unstubAllEnvs();
  });

  it("every exported action checks auth before doing anything", async () => {
    process.env.NEXUS_ACCESS_TOKEN = "t1";
    const actions = await import("@/lib/actions");
    const names = Object.keys(actions).filter((k) => typeof (actions as Record<string, unknown>)[k] === "function");
    expect(names.length).toBeGreaterThanOrEqual(7);
    for (const name of names) {
      const fn = (actions as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name];
      await expect(fn("x", true, "y"), name).rejects.toBeInstanceOf(UnauthorizedError);
    }
  });

  it("login sets the session cookie only for the right token", async () => {
    process.env.NEXUS_ACCESS_TOKEN = "t1";
    const { loginAction, logoutAction } = await import("@/lib/authActions");
    const bad = new FormData();
    bad.set("token", "nope");
    expect(await loginAction({}, bad)).toEqual({ error: "Wrong access token." });
    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
    const good = new FormData();
    good.set("token", "t1");
    await expect(loginAction({}, good)).rejects.toThrow("REDIRECT:/");
    expect(cookieJar.get(SESSION_COOKIE)).toBe(await sessionValue("t1"));
    await expect(logoutAction()).rejects.toThrow("REDIRECT:/login");
    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
  });
});

describe("proxy", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  async function run(path: string, method = "GET", cookie?: string) {
    const { proxy } = await import("@/proxy");
    const { NextRequest } = await import("next/server");
    const headers = new Headers();
    if (cookie) headers.set("cookie", `${SESSION_COOKIE}=${cookie}`);
    return proxy(new NextRequest(new URL(path, "http://localhost:3000"), { method, headers }));
  }

  it("redirects pages and 401s posts without a session; passes /login and valid sessions", async () => {
    process.env.NEXUS_ACCESS_TOKEN = "t1";
    const page = await run("/approvals");
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("http://localhost:3000/login");
    expect((await run("/approvals", "HEAD")).status).toBe(307);
    expect((await run("/", "POST")).status).toBe(401);
    expect((await run("/login")).headers.get("x-middleware-next")).toBe("1");
    const ok = await run("/", "POST", await sessionValue("t1"));
    expect(ok.headers.get("x-middleware-next")).toBe("1");
  });

  it("does nothing when no token is configured", async () => {
    delete process.env.NEXUS_ACCESS_TOKEN;
    expect((await run("/approvals", "POST")).headers.get("x-middleware-next")).toBe("1");
  });
});
