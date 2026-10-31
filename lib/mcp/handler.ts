import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateApiKey, type ApiAuthEnv } from "../apiAuth";
import { recordApiAccess } from "../agents/tools";
import { loadState, persistState } from "../domain/store";
import { buildMcpServer } from "./server";

// Streamable HTTP MCP endpoint (stateless, JSON responses). Runs inside the
// NEXUS server process so it shares the one working set the UI and API use:
// authenticate -> hydrate -> handle tool calls -> audit -> persist.

function requestIdFor(): string {
  return `mcp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function jsonRpcError(status: number, message: string): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message }, id: null }), {
    status,
    headers: { "content-type": "application/json", ...(status === 401 ? { "www-authenticate": "Bearer" } : {}) },
  });
}

export async function handleMcpRequest(request: Request): Promise<Response> {
  const auth = authenticateApiKey(process.env as ApiAuthEnv, request.headers.get("authorization"));
  const requestId = requestIdFor();
  if (!auth.ok) {
    if (auth.keyId) {
      await loadState();
      recordApiAccess({
        keyId: auth.keyId,
        subject: "unknown",
        tenantId: "n/a",
        method: request.method,
        path: "/api/mcp",
        scope: "mcp",
        outcome: "DENIED",
        status: auth.status,
        requestId,
        channel: "MCP",
      });
      await persistState();
    }
    return jsonRpcError(auth.status, auth.message);
  }

  await loadState();
  const server = buildMcpServer(auth.principal, requestId);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    await persistState();
    return response;
  } finally {
    await server.close();
  }
}
