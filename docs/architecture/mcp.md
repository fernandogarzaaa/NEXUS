# MCP server

NEXUS exposes a Model Context Protocol server at **`POST /api/mcp`**
(Streamable HTTP, stateless, JSON responses), built with
`@modelcontextprotocol/sdk`. It runs inside the NEXUS server process, so it
works on the same working set as the UI and the REST API and goes through
the same hydrate → act → persist cycle.

## Layering (hard constraint)

```
MCP client -> /api/mcp -> lib/mcp/server.ts -> lib/queries.ts | lib/agents/tools.ts | agents -> StateRepository -> (memory | Postgres)
```

`lib/mcp/` never touches the store or a database. Every tool input is
validated by Zod (the SDK validates the tool's input schema; the tool layer
validates again), and every call is audited.

## Identity

There is no anonymous or demo identity. A client authenticates with an
API key from `NEXUS_API_KEYS` (`Authorization: Bearer <keyId>.<secret>`).
Each key maps to a real subject (person or service account), a tenant,
roles and scopes; keys for another tenant than `NEXUS_TENANT_ID` are
refused. The server only registers the tools the key may use, and every
call writes an `MCP_TOOL_CALL` audit event whose actor is the subject,
key id and tenant. Refused callers with a recognised key are audited as
`MCP_ACCESS_DENIED`.

## Tools

| Tool | Needs | Effect |
|---|---|---|
| `get_summary` | `read:summary` | KPIs |
| `list_shipments`, `get_shipment` | `read:shipments` | shipments; full detail incl. agent runs and audit |
| `list_exceptions` | `read:exceptions` | exceptions |
| `get_driver`, `find_alternative_driver` | `read:drivers` | driver; best available alternative (no assignment) |
| `list_approvals` | `read:approvals` | approval queue |
| `list_policies` | `read:policies` | autonomy policies |
| `get_audit_log` | `read:audit` | audit events |
| `ask_knowledge` | `read:knowledge` | cited answer or `NOT_FOUND` (see `knowledge.md`) |
| `request_driver_reassignment` | `request:actions` **and** role `operator`/`admin` | **queues** a reassignment in the human approval queue |

## Writes stay approval gated

`request_driver_reassignment` calls `requestReassignmentApproval` in the
Dynamic Dispatch Agent. It always requests human approval, even when the
`DRIVER_REASSIGNMENT` policy has been made autonomous; under `OBSERVE` it
only records the request. The approval names the requester. It is
idempotent per shipment while an approval is pending. Nothing executes
until a person approves in the Approvals screen, which resumes the run
through the existing `resumeDispatchAfterApproval` path. No MCP tool can
decide an approval, change a policy, reset state or run a simulation.
`request:actions` is never implied by `read:*`.

## Connecting a client

```json
{
  "mcpServers": {
    "nexus": {
      "type": "http",
      "url": "https://<nexus-host>/api/mcp",
      "headers": { "Authorization": "Bearer <keyId>.<secret>" }
    }
  }
}
```

## Not built

- OAuth for MCP clients: API keys are the identity mechanism for now.
- More write tools (appointment reschedule, carrier rebook): each needs an
  approval-gated request path like the reassignment one before it is exposed.
- A stdio transport: a separate process would hold its own copy of the
  working set, which the single-writer Postgres backend does not support.
