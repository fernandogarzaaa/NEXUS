import { handleMcpRequest } from "@/lib/mcp/handler";

export const dynamic = "force-dynamic";

// MCP Streamable HTTP endpoint. Authenticate with an API key from
// NEXUS_API_KEYS: `Authorization: Bearer <keyId>.<secret>`. See docs/architecture/mcp.md.
export const POST = handleMcpRequest;
export const GET = handleMcpRequest;
export const DELETE = handleMcpRequest;
