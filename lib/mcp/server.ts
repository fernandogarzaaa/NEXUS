import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { hasRole, hasScope, type ApiPrincipal, type ApiScope } from "../apiAuth";
import { findAlternativeDriver, getDriver, recordApiAccess, ToolExecutionError, ToolValidationError } from "../agents/tools";
import { requestReassignmentApproval } from "../agents/dynamicDispatchAgent";
import { getSummary, getShipmentDetail, listApprovals, listAuditLog, listExceptions, listPolicies, listShipments } from "../queries";
import { askKnowledge } from "../knowledge/service";

// ---------------------------------------------------------------------------
// NEXUS MCP server. The layering is fixed: MCP -> lib/queries.ts / the typed
// tool layer / the agents -> the StateRepository. This module never touches
// the store or a database directly.
//
// - Identity: every session is an API-key principal (a real subject in a
//   real tenant); tools the principal's scopes/roles do not allow are not
//   even registered, and every call is audited under that subject.
// - Read tools first. The one write tool only queues a request in the human
//   approval queue; nothing an MCP client does can execute an operational
//   change or decide an approval.
// ---------------------------------------------------------------------------

export const MCP_SERVER_INFO = { name: "nexus", version: "0.4.0" };

interface ToolSpec {
  name: string;
  scope: ApiScope;
  roles?: Array<ApiPrincipal["roles"][number]>;
  description: string;
  inputSchema: z.ZodRawShape;
  readOnly: boolean;
  run: (args: Record<string, unknown>, ctx: { principal: ApiPrincipal }) => unknown;
}

const limit = z.number().int().min(1).max(200).optional().describe("Maximum items to return (default 50).");

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: "get_summary",
    scope: "read:summary",
    description: "Command-center KPIs: shipment counts, on-time rate, active and critical exceptions, autonomous actions, pending approvals.",
    inputSchema: {},
    readOnly: true,
    run: () => getSummary(),
  },
  {
    name: "list_shipments",
    scope: "read:shipments",
    description: "List shipments, optionally filtered by status, priority or driver.",
    inputSchema: {
      status: z.enum(["SCHEDULED", "IN_TRANSIT", "AT_FACILITY", "EXCEPTION", "DELIVERED", "CANCELLED"]).optional(),
      priority: z.enum(["STANDARD", "HIGH", "CRITICAL"]).optional(),
      driverId: z.string().optional(),
      limit,
    },
    readOnly: true,
    run: (a) =>
      listShipments()
        .filter((s) => (!a.status || s.status === a.status) && (!a.priority || s.priority === a.priority) && (!a.driverId || s.driverId === a.driverId))
        .slice(0, (a.limit as number | undefined) ?? 50),
  },
  {
    name: "get_shipment",
    scope: "read:shipments",
    description: "Full detail for one shipment: driver, vehicle, route, facilities, exceptions, agent runs with steps and tool actions, communications and audit history.",
    inputSchema: { id: z.string().min(1).describe("Shipment id, e.g. SHP-2000") },
    readOnly: true,
    run: (a) => {
      const detail = getShipmentDetail(a.id as string);
      if (!detail) throw new ToolExecutionError("get_shipment", `unknown shipment ${String(a.id)}`);
      return detail;
    },
  },
  {
    name: "list_exceptions",
    scope: "read:exceptions",
    description: "List operational exceptions, newest first, optionally filtered by status or severity.",
    inputSchema: {
      status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "ESCALATED"]).optional(),
      severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
      limit,
    },
    readOnly: true,
    run: (a) =>
      listExceptions()
        .filter((e) => (!a.status || e.status === a.status) && (!a.severity || e.severity === a.severity))
        .slice(0, (a.limit as number | undefined) ?? 50),
  },
  {
    name: "get_driver",
    scope: "read:drivers",
    description: "One driver: status, location, hours of service, on-time rating, vehicle and assigned shipments.",
    inputSchema: { id: z.string().min(1).describe("Driver id, e.g. D-07") },
    readOnly: true,
    run: (a) => getDriver(a.id as string),
  },
  {
    name: "find_alternative_driver",
    scope: "read:drivers",
    description: "The best available driver who could take a shipment (read only; does not assign).",
    inputSchema: { shipmentId: z.string().min(1) },
    readOnly: true,
    run: (a) => findAlternativeDriver({ shipmentId: a.shipmentId as string }) ?? { found: false },
  },
  {
    name: "list_approvals",
    scope: "read:approvals",
    description: "Human approval queue, newest first, optionally filtered by status.",
    inputSchema: { status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(), limit },
    readOnly: true,
    run: (a) => listApprovals().filter((x) => !a.status || x.status === a.status).slice(0, (a.limit as number | undefined) ?? 50),
  },
  {
    name: "list_policies",
    scope: "read:policies",
    description: "Autonomy policies per action type: autonomy level and cost threshold.",
    inputSchema: {},
    readOnly: true,
    run: () => listPolicies(),
  },
  {
    name: "get_audit_log",
    scope: "read:audit",
    description: "Audit events, newest first, optionally for one entity id.",
    inputSchema: { entityId: z.string().optional(), limit },
    readOnly: true,
    run: (a) =>
      listAuditLog(Number.MAX_SAFE_INTEGER)
        .filter((e) => !a.entityId || e.entityId === a.entityId)
        .slice(0, (a.limit as number | undefined) ?? 50),
  },
  {
    name: "ask_knowledge",
    scope: "read:knowledge",
    description:
      "Answer a question from canonical records and ops documents. Every sentence cites its source record and timestamp; returns status NOT_FOUND rather than guessing when no fresh source exists.",
    inputSchema: {
      question: z.string().min(1).max(500),
      maxAgeHours: z.number().positive().optional(),
      types: z.array(z.enum(["shipment", "driver", "vehicle", "facility", "exception", "approval", "agentRun", "policy", "opsDoc"])).optional(),
    },
    readOnly: true,
    run: (a) =>
      askKnowledge(a.question as string, {
        maxAgeHours: a.maxAgeHours as number | undefined,
        sourceTypes: a.types as string[] | undefined,
      }),
  },
  {
    name: "request_driver_reassignment",
    scope: "request:actions",
    roles: ["operator", "admin"],
    description:
      "Ask for a shipment to be reassigned to the best available driver. This never executes: it creates a request in the human approval queue, attributed to you. A person must approve it in NEXUS.",
    inputSchema: {
      shipmentId: z.string().min(1),
      reason: z.string().min(10).max(500).describe("Why the reassignment is needed; shown to the approver."),
    },
    readOnly: false,
    run: (a, { principal }) => {
      const result = requestReassignmentApproval(
        a.shipmentId as string,
        { subject: principal.subject, tenantId: principal.tenantId, keyId: principal.keyId, channel: "MCP" },
        a.reason as string
      );
      return {
        status: result.approvalId ? "PENDING_APPROVAL" : result.run?.status ?? "UNKNOWN",
        approvalId: result.approvalId,
        agentRunId: result.run?.id ?? null,
        message: result.reason,
      };
    },
  },
];

export function allowedTools(principal: ApiPrincipal): ToolSpec[] {
  return TOOL_SPECS.filter((t) => hasScope(principal, t.scope) && (!t.roles || hasRole(principal, ...t.roles)));
}

function result(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: { result: value as never } };
}

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** Build a server exposing only the tools this principal may use. One per request (stateless). */
export function buildMcpServer(principal: ApiPrincipal, requestId: string): McpServer {
  const server = new McpServer(MCP_SERVER_INFO, {
    instructions:
      `You are connected to NEXUS as ${principal.subject} (tenant ${principal.tenantId}). ` +
      "Read tools return live operational data. Write tools only queue requests for human approval; they never execute changes.",
  });
  for (const spec of allowedTools(principal)) {
    server.registerTool(
      spec.name,
      {
        description: spec.description,
        inputSchema: spec.inputSchema,
        annotations: { readOnlyHint: spec.readOnly, destructiveHint: false, idempotentHint: spec.readOnly, openWorldHint: false },
      },
      async (args: Record<string, unknown>) => {
        let outcome: CallToolResult;
        try {
          outcome = result(await spec.run(args ?? {}, { principal }));
        } catch (err) {
          if (err instanceof ToolValidationError || err instanceof ToolExecutionError) outcome = errorResult(err.message);
          else throw err;
        }
        recordApiAccess({
          keyId: principal.keyId,
          subject: principal.subject,
          tenantId: principal.tenantId,
          method: "MCP",
          path: `tools/call/${spec.name}`,
          scope: spec.scope,
          outcome: "ALLOWED",
          status: outcome.isError ? 400 : 200,
          requestId: `${requestId}:${spec.name}`,
          channel: "MCP",
        });
        return outcome;
      }
    );
  }
  return server;
}
