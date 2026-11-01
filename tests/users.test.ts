import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ForbiddenError,
  SESSION_COOKIE,
  UnauthorizedError,
  actionsDisabledByConfig,
  decide,
  parseUsers,
  signUserSession,
  verifyUserSession,
  type UiUser,
} from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/passwords";
import { getState, resetState } from "@/lib/domain/store";
import { HERO_DRIVER_ID, HERO_SHIPMENT_ID } from "@/lib/domain/seed";
import { evaluateDispatchAssignment } from "@/lib/agents/dynamicDispatchAgent";

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

const SECRET = "x".repeat(40);
const PASS = "correct horse battery";
// One scrypt hash, reused, keeps the suite fast.
const HASH = hashPassword(PASS);
const USERS = [
  { username: "jane", displayName: "Jane Citizen", passwordHash: HASH, tenantId: "senor-pilot", roles: ["operator"] },
  { username: "amir", displayName: "Amir Admin", passwordHash: HASH, tenantId: "senor-pilot", roles: ["admin"] },
  { username: "vic", displayName: "Vic Viewer", passwordHash: HASH, tenantId: "senor-pilot", roles: ["viewer"] },
  { username: "olga", displayName: "Other Tenant", passwordHash: HASH, tenantId: "elsewhere", roles: ["admin"] },
];
const ENV = { NEXUS_USERS: JSON.stringify(USERS), NEXUS_SESSION_SECRET: SECRET, NEXUS_TENANT_ID: "senor-pilot" };
const jane = USERS[0] as UiUser;

describe("password hashing", () => {
  it("verifies the right password only and refuses short ones", () => {
    expect(HASH).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(verifyPassword(PASS, HASH)).toBe(true);
    expect(verifyPassword("wrong password!!", HASH)).toBe(false);
    expect(verifyPassword(PASS, undefined)).toBe(false);
    expect(() => hashPassword("short")).toThrow(/12 characters/);
  });
});

describe("user sessions (pure)", () => {
  it("parses users and rejects bad config", () => {
    expect(parseUsers(ENV)).toHaveLength(4);
    expect(() => parseUsers({ NEXUS_USERS: "[{}]" })).toThrow(/NEXUS_USERS is invalid/);
    expect(() => parseUsers({ NEXUS_USERS: JSON.stringify([USERS[0], { ...USERS[0], username: "JANE" }]) })).toThrow(/duplicate/);
  });

  it("signs and verifies a session, and rejects tampering, expiry and other tenants", async () => {
    const now = 1_800_000_000;
    const cookie = await signUserSession(ENV, jane, now);
    expect((await verifyUserSession(ENV, cookie, now + 60))?.username).toBe("jane");
    expect(await verifyUserSession(ENV, cookie, now + 13 * 3600)).toBeNull(); // expired
    const [v, body, sig] = cookie.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), u: "amir" })).toString("base64url");
    expect(await verifyUserSession(ENV, `${v}.${forgedBody}.${sig}`, now)).toBeNull();
    expect(await verifyUserSession({ ...ENV, NEXUS_SESSION_SECRET: "y".repeat(40) }, cookie, now)).toBeNull();
    expect(await verifyUserSession({ ...ENV, NEXUS_TENANT_ID: "elsewhere" }, cookie, now)).toBeNull();
  });

  it("ends sessions when the user's password changes or the user is removed", async () => {
    const cookie = await signUserSession(ENV, jane);
    const changed = { ...ENV, NEXUS_USERS: JSON.stringify([{ ...USERS[0], passwordHash: hashPassword("a different password") }]) };
    expect(await verifyUserSession(changed, cookie)).toBeNull();
    const removed = { ...ENV, NEXUS_USERS: JSON.stringify([USERS[1]]) };
    expect(await verifyUserSession(removed, cookie)).toBeNull();
  });

  it("requires a strong session secret and takes precedence over the shared token", async () => {
    await expect(signUserSession({ ...ENV, NEXUS_SESSION_SECRET: "short" }, jane)).rejects.toThrow(/NEXUS_SESSION_SECRET/);
    const env = { ...ENV, NEXUS_ACCESS_TOKEN: "shared", NODE_ENV: "production" };
    expect(await decide(env, undefined)).toBe("login_required");
    expect(await decide(env, await signUserSession(env, jane))).toBe("allow");
    expect(actionsDisabledByConfig(env)).toBe(false);
  });
});

describe("users mode end to end", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    cookieJar.clear();
    resetState();
    Object.assign(process.env, ENV);
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  async function signIn(username: string, password = PASS) {
    const { loginAction } = await import("@/lib/authActions");
    const form = new FormData();
    form.set("username", username);
    form.set("password", password);
    return loginAction({}, form).catch((e: Error) => e.message);
  }

  it("logs in named users of this tenant only", async () => {
    expect(await signIn("jane", "wrong password!!")).toEqual({ error: "Wrong username or password." });
    expect(await signIn("nobody")).toEqual({ error: "Wrong username or password." });
    expect(await signIn("olga")).toEqual({ error: "Wrong username or password." });
    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
    expect(await signIn("JANE")).toBe("REDIRECT:/");
    expect(cookieJar.get(SESSION_COOKIE)).toMatch(/^u1\./);
  });

  it("records the signed-in person as approver and audits the decision", async () => {
    const { decideApprovalAction } = await import("@/lib/actions");
    getState().drivers.get(HERO_DRIVER_ID)!.status = "DELAYED";
    const { run } = evaluateDispatchAssignment(HERO_SHIPMENT_ID);
    const approval = Array.from(getState().approvals.values()).find((a) => a.agentRunId === run!.id)!;

    await expect(decideApprovalAction(approval.id, true)).rejects.toBeInstanceOf(UnauthorizedError);
    await signIn("vic");
    await expect(decideApprovalAction(approval.id, true)).rejects.toBeInstanceOf(ForbiddenError);
    expect(approval.status).toBe("PENDING");

    await signIn("jane");
    await decideApprovalAction(approval.id, true);
    expect(approval).toMatchObject({ status: "APPROVED", resolvedBy: "Jane Citizen (jane)" });
    const audit = getState().auditLog.find((a) => a.action === "APPROVE_ACTION")!;
    expect(audit).toMatchObject({ actorType: "HUMAN", actorId: "Jane Citizen (jane)", entityId: approval.id });
  });

  it("restricts policy edits and reset to admins, and audits them", async () => {
    const { updatePolicyAction, resetDemoAction, runHeroDemoAction } = await import("@/lib/actions");
    await signIn("jane");
    await expect(updatePolicyAction("APPOINTMENT_RESCHEDULE", "RECOMMEND", 50)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(resetDemoAction()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(runHeroDemoAction()).resolves.toBeUndefined(); // operators can run scenarios

    await signIn("amir");
    await updatePolicyAction("APPOINTMENT_RESCHEDULE", "RECOMMEND", 50);
    expect(getState().policies.get("APPOINTMENT_RESCHEDULE")).toMatchObject({ autonomyLevel: "RECOMMEND", maxCost: 50 });
    expect(getState().auditLog.at(-1)).toMatchObject({ action: "UPDATE_POLICY", actorId: "Amir Admin (amir)" });
    await resetDemoAction();
    expect(getState().auditLog).toEqual([expect.objectContaining({ action: "RESET_STATE", actorId: "Amir Admin (amir)" })]);
  });

  it("viewers can read pages but cannot run anything", async () => {
    const { canViewPages, currentPrincipal } = await import("@/lib/authServer");
    expect(await canViewPages()).toBe(false);
    await signIn("vic");
    expect(await canViewPages()).toBe(true);
    expect(await currentPrincipal()).toMatchObject({ mode: "users", named: true, displayName: "Vic Viewer", roles: ["viewer"] });
    const { runDispatchSweepAction } = await import("@/lib/actions");
    await expect(runDispatchSweepAction()).rejects.toBeInstanceOf(ForbiddenError);
  });
});
