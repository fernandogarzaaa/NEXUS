# Public read API (v1)

Base path: `/api/v1`. JSON only. Read-only in this version: every route is
`GET`, backed by `lib/queries.ts` (read-side selectors) or the typed tool
layer (`lib/agents/tools.ts`); route files never touch the store directly.

## Authentication and scopes

```
Authorization: Bearer <keyId>.<secret>
```

Keys are configured in `NEXUS_API_KEYS` (JSON array). Each key names a
real subject, a tenant, roles and scopes:

```json
[{"id":"ops-dashboard","secret":"<at least 16 chars>","subject":"ops@senor.example",
  "tenantId":"senor-pilot","roles":["viewer"],"scopes":["read:*"]}]
```

- Secrets are compared in constant time; unknown ids and wrong secrets
  both answer `401 invalid_key`.
- `NEXUS_TENANT_ID` (default `demo`) is the tenant this deployment serves.
  A key for another tenant is refused with `403 wrong_tenant`. One
  deployment serves one tenant; row-level multi-tenancy inside a single
  database is not built.
- Scopes: `read:summary`, `read:shipments`, `read:drivers`,
  `read:vehicles`, `read:facilities`, `read:exceptions`,
  `read:approvals`, `read:policies`, `read:agent-runs`, `read:audit`, or
  `read:*`. A missing scope answers `403 insufficient_scope`.
- Roles (`viewer`, `operator`, `admin`) are recorded on the key now and
  will gate the write routes when those are added behind the approval
  queue.
- With no keys configured the API answers `503 no_keys_configured`.
- The shared UI token (`NEXUS_ACCESS_TOKEN`) does not authenticate API
  calls; `proxy.ts` leaves `/api/v1/*` to key auth.

## Audit

Every request made with a recognised key is written to the audit log via
`recordApiAccess` in the tool layer: `API_READ` on success,
`API_ACCESS_DENIED` for tenant/scope refusals. The actor is the key's
subject. Anonymous and invalid-key attempts are not persisted so they
cannot flood the log. Supply `x-request-id` to correlate; it is echoed and
stored as the audit entity id.

## Routes

| Route | Scope | Query |
|---|---|---|
| `GET /health` | none | liveness + configuration only, never data |
| `GET /summary` | `read:summary` | |
| `GET /shipments` | `read:shipments` | `status`, `priority`, `driverId`, `limit`, `offset` |
| `GET /shipments/{id}` | `read:shipments` | full detail: driver, vehicle, route, facilities, exceptions, agent runs with steps/actions, communications, audit |
| `GET /drivers` | `read:drivers` | `status`, `limit`, `offset` |
| `GET /drivers/{id}` | `read:drivers` | |
| `GET /vehicles` | `read:vehicles` | `limit`, `offset` |
| `GET /facilities` | `read:facilities` | `limit`, `offset` |
| `GET /exceptions` | `read:exceptions` | `status`, `severity`, `limit`, `offset` |
| `GET /approvals` | `read:approvals` | `status`, `limit`, `offset` |
| `GET /policies` | `read:policies` | |
| `GET /agent-runs` | `read:agent-runs` | `status`, `agentType`, `limit`, `offset` |
| `GET /audit` | `read:audit` | `entityId`, `action`, `limit`, `offset` (newest first) |

List responses: `{ "data": { "items": [...], "page": { "limit", "offset", "total" } }, "meta": {...} }`.
`limit` defaults to 100, max 500. Errors: `{ "error": { "code", "message" }, "meta": { "requestId" } }`.

## Example

```bash
curl -s http://localhost:3000/api/v1/shipments?priority=CRITICAL \
  -H "Authorization: Bearer ops-dashboard.<secret>" -H "x-request-id: demo-1" | jq .data.page
```
