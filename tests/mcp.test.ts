import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getState, resetState } from "@/lib/domain/store";
import { HERO_DRIVER_ID, HERO_SHIPMENT_ID } from "@/lib/domain/seed";
import { updatePolicy } from "@/lib/agents/policyEngine";
import { decideApprovalAction } from "@/lib/actions";
import { POST } from "@/app/api/mcp/route";
import { proxy } from "@/proxy";
import { NextRequest } from "next/server";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const SECRET = "mcp-secret-0123456789abcdef";
const KEYS = [
  { id: "agent", secret: SECRET, subject: "dispatch-assistant@senor.example", tenantId: "senor-pilot", roles: ["operator"], scopes: ["read:*", "request:actions"] },
  { id: "viewer", secret: SECRET, subject: "analyst@senor.example", tenantId: "senor-pilot", roles: ["viewer"], scopes: ["read:shipments", "read:knowledge", "request:actions"] },
  { id: "foreign", secret: SECRET, subject: "x@other.example", tenantId: "other", roles: ["admin"], scopes: ["read:*"] },
];

async function connect(token: string) {
  const transport = new StreamableHTTPClientTransport(new URL("http://nexus.local/api/mcp"), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: (input, init) => POST(new Request(input, init)),
  });
  const client = new Client({ name: "nexus-test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

function parse(res: Awaited<ReturnType<Client["callTool"]>>) {
  const content = res.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text);
}

describe("MCP endpoint", () => {
  beforeEach(() => {
    resetState();
    vi.stubEnv("NEXUS_API_KEYS", JSON.stringify(KEYS));
    vi.stubEnv("NEXUS_TENANT_ID", "senor-pilot");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("refuses anonymous, invalid and other-tenant callers before any MCP handling", async () => {
    const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } } };
    const call = (auth?: string) =>
      POST(new Request("http://nexus.local/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(auth ? { authorization: auth } : {}) },
        body: JSON.stringify(init),
      }));
    expect((await call()).status).toBe(401);
    expect((await call(`Bearer agent.wrong`)).status).toBe(401);
    expect((await call(`Bearer foreign.${SECRET}`)).status).toBe(403);
    expect(getState().auditLog.at(-1)).toMatchObject({ action: "MCP_ACCESS_DENIED" });
  });

  it("lists only the tools the key's scopes and roles allow", async () => {
    const agent = await connect(`agent.${SECRET}`);
    const names = (await agent.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "ask_knowledge", "find_alternative_driver", "get_audit_log", "get_driver", "get_shipment", "get_summary",
      "list_approvals", "list_exceptions", "list_policies", "list_shipments", "request_driver_reassignment",
    ]);
    const write = (await agent.listTools()).tools.find((t) => t.name === "request_driver_reassignment")!;
    expect(write.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });

    // request:actions without the operator role is not enough to see the write tool.
    const viewer = await connect(`viewer.${SECRET}`);
    expect((await viewer.listTools()).tools.map((t) => t.name).sort()).toEqual(["ask_knowledge", "get_shipment", "list_shipments"]);
  });

  it("serves read tools from the tool layer and queries, audited under the real subject", async () => {
    const client = await connect(`agent.${SECRET}`);
    const shipment = parse(await client.callTool({ name: "get_shipment", arguments: { id: HERO_SHIPMENT_ID } }));
    expect(shipment.shipment.driverId).toBe(HERO_DRIVER_ID);
    const audit = getState().auditLog.at(-1)!;
    expect(audit).toMatchObject({ action: "MCP_TOOL_CALL", entityType: "McpRequest", actorType: "HUMAN" });
    expect(audit.actorId).toContain("dispatch-assistant@senor.example");
    expect(audit.actorId).toContain("tenant senor-pilot");
    expect(audit.detail).toContain("tools/call/get_shipment");

    const missing = await client.callTool({ name: "get_driver", arguments: { id: "D-99" } });
    expect(missing.isError).toBe(true);
    const invalid = await client.callTool({ name: "list_shipments", arguments: { priority: "URGENT" } });
    expect(invalid.isError).toBe(true);

    const answer = parse(await client.callTool({ name: "ask_knowledge", arguments: { question: "status of SHP-2000" } }));
    expect(answer.status).toBe("ANSWERED");
    expect(answer.citations[0]).toMatchObject({ sourceId: HERO_SHIPMENT_ID });
    const notFound = parse(await client.callTool({ name: "ask_knowledge", arguments: { question: "where is SHP-4242" } }));
    expect(notFound.status).toBe("NOT_FOUND");
  });

  it("write tool only queues an approval; a human decision is what executes it", async () => {
    const client = await connect(`agent.${SECRET}`);
    const res = parse(
      await client.callTool({ name: "request_driver_reassignment", arguments: { shipmentId: HERO_SHIPMENT_ID, reason: "Driver reported a breakdown near Waco." } })
    );
    expect(res.status).toBe("PENDING_APPROVAL");
    const state = getState();
    expect(state.shipments.get(HERO_SHIPMENT_ID)!.driverId).toBe(HERO_DRIVER_ID); // nothing executed
    const approval = state.approvals.get(res.approvalId)!;
    expect(approval).toMatchObject({ status: "PENDING", actionType: "DRIVER_REASSIGNMENT" });
    expect(approval.contextNotes.join(" ")).toContain("dispatch-assistant@senor.example via MCP");
    expect(state.agentRuns.get(res.agentRunId)).toMatchObject({ status: "AWAITING_APPROVAL", triggerEventType: "MCP_REQUEST" });

    // Asking twice does not create a second approval.
    const again = parse(
      await client.callTool({ name: "request_driver_reassignment", arguments: { shipmentId: HERO_SHIPMENT_ID, reason: "Driver reported a breakdown near Waco." } })
    );
    expect(again.approvalId).toBe(res.approvalId);
    expect(Array.from(state.approvals.values()).filter((a) => a.status === "PENDING")).toHaveLength(1);

    // There is no MCP tool that decides approvals; a person does it in the UI.
    expect((await client.listTools()).tools.some((t) => /approve|decide/.test(t.name))).toBe(false);
    await decideApprovalAction(res.approvalId, true, "Ops Manager Jane Citizen");
    expect(state.shipments.get(HERO_SHIPMENT_ID)!.driverId).not.toBe(HERO_DRIVER_ID);
    expect(state.agentRuns.get(res.agentRunId)!.status).toBe("COMPLETED");
  });

  it("still requires approval when the reassignment policy is autonomous, and only reports under OBSERVE", async () => {
    updatePolicy("DRIVER_REASSIGNMENT", { autonomyLevel: "OPERATIONAL_AUTONOMOUS", maxCostUsd: null });
    const client = await connect(`agent.${SECRET}`);
    const before1000 = getState().shipments.get("SHP-1000")!.driverId;
    const res = parse(await client.callTool({ name: "request_driver_reassignment", arguments: { shipmentId: "SHP-1000", reason: "Customer asked for a different driver." } }));
    expect(res.status).toBe("PENDING_APPROVAL");
    expect(getState().shipments.get("SHP-1000")!.driverId).toBe(before1000); // autonomous policy did not execute it

    updatePolicy("DRIVER_REASSIGNMENT", { autonomyLevel: "OBSERVE" });
    const originalDriver = getState().shipments.get("SHP-1001")!.driverId;
    const observed = parse(await client.callTool({ name: "request_driver_reassignment", arguments: { shipmentId: "SHP-1001", reason: "Customer asked for a different driver." } }));
    expect(observed).toMatchObject({ status: "COMPLETED", approvalId: null });
    expect(getState().shipments.get("SHP-1001")!.driverId).toBe(originalDriver);
    expect(Array.from(getState().approvals.values()).filter((a) => a.shipmentId === "SHP-1001")).toHaveLength(0);
  });

  it("the UI cookie gate leaves /api/mcp to key auth", async () => {
    vi.stubEnv("NEXUS_ACCESS_TOKEN", "ui-token");
    expect((await proxy(new NextRequest("http://nexus.local/api/mcp", { method: "POST" }))).status).toBe(200);
  });
});
