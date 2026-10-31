-- NEXUS canonical state, Postgres backend (NEXUS_STATE_BACKEND=postgres).
--
-- Every table stores the canonical record as-is in `data` (jsonb) so the
-- shape is exactly lib/domain/types.ts and hydration is lossless. The
-- typed columns beside it are GENERATED from `data`: they exist for SQL
-- reporting, foreign-key-style lookups and indexes, and can never drift
-- from the record because Postgres derives them on write.
--
-- `ord` records insertion order so a hydrated working set iterates in the
-- same order as the one that was persisted (Map order matters to callers).
--
-- Timestamps are kept as ISO-8601 UTC text (the application's own format);
-- they sort correctly as text and round-trip byte-for-byte.

CREATE TABLE IF NOT EXISTS nexus_meta (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS facilities (
  ord   bigserial,
  id    text PRIMARY KEY,
  data  jsonb NOT NULL,
  name  text GENERATED ALWAYS AS (data->>'name') STORED,
  type  text GENERATED ALWAYS AS (data->>'type') STORED,
  city  text GENERATED ALWAYS AS (data->>'city') STORED,
  state text GENERATED ALWAYS AS (data->>'state') STORED
);

CREATE TABLE IF NOT EXISTS vehicles (
  ord   bigserial,
  id                text PRIMARY KEY,
  data              jsonb NOT NULL,
  type              text GENERATED ALWAYS AS (data->>'type') STORED,
  status            text GENERATED ALWAYS AS (data->>'status') STORED,
  current_driver_id text GENERATED ALWAYS AS (data->>'currentDriverId') STORED
);

CREATE TABLE IF NOT EXISTS drivers (
  ord   bigserial,
  id               text PRIMARY KEY,
  data             jsonb NOT NULL,
  name             text GENERATED ALWAYS AS (data->>'name') STORED,
  status           text GENERATED ALWAYS AS (data->>'status') STORED,
  home_facility_id text GENERATED ALWAYS AS (data->>'homeFacilityId') STORED,
  vehicle_id       text GENERATED ALWAYS AS (data->>'vehicleId') STORED
);

CREATE TABLE IF NOT EXISTS shipments (
  ord   bigserial,
  id                      text PRIMARY KEY,
  data                    jsonb NOT NULL,
  reference_code          text GENERATED ALWAYS AS (data->>'referenceCode') STORED,
  customer_name           text GENERATED ALWAYS AS (data->>'customerName') STORED,
  status                  text GENERATED ALWAYS AS (data->>'status') STORED,
  priority                text GENERATED ALWAYS AS (data->>'priority') STORED,
  driver_id               text GENERATED ALWAYS AS (data->>'driverId') STORED,
  vehicle_id              text GENERATED ALWAYS AS (data->>'vehicleId') STORED,
  route_id                text GENERATED ALWAYS AS (data->>'routeId') STORED,
  origin_facility_id      text GENERATED ALWAYS AS (data->>'originFacilityId') STORED,
  destination_facility_id text GENERATED ALWAYS AS (data->>'destinationFacilityId') STORED,
  current_eta             text GENERATED ALWAYS AS (data->>'currentEta') STORED,
  updated_at              text GENERATED ALWAYS AS (data->>'updatedAt') STORED
);
CREATE INDEX IF NOT EXISTS shipments_status_idx ON shipments (status);
CREATE INDEX IF NOT EXISTS shipments_driver_idx ON shipments (driver_id);
CREATE INDEX IF NOT EXISTS shipments_reference_idx ON shipments (reference_code);

CREATE TABLE IF NOT EXISTS routes (
  ord   bigserial,
  id          text PRIMARY KEY,
  data        jsonb NOT NULL,
  shipment_id text GENERATED ALWAYS AS (data->>'shipmentId') STORED
);
CREATE INDEX IF NOT EXISTS routes_shipment_idx ON routes (shipment_id);

CREATE TABLE IF NOT EXISTS exceptions (
  ord   bigserial,
  id           text PRIMARY KEY,
  data         jsonb NOT NULL,
  shipment_id  text GENERATED ALWAYS AS (data->>'shipmentId') STORED,
  type         text GENERATED ALWAYS AS (data->>'type') STORED,
  severity     text GENERATED ALWAYS AS (data->>'severity') STORED,
  status       text GENERATED ALWAYS AS (data->>'status') STORED,
  agent_run_id text GENERATED ALWAYS AS (data->>'agentRunId') STORED,
  detected_at  text GENERATED ALWAYS AS (data->>'detectedAt') STORED
);
CREATE INDEX IF NOT EXISTS exceptions_shipment_idx ON exceptions (shipment_id);
CREATE INDEX IF NOT EXISTS exceptions_status_idx ON exceptions (status);

-- Keyed by action type (the in-memory Map key), not by the policy id.
CREATE TABLE IF NOT EXISTS policies (
  ord   bigserial,
  action_type    text PRIMARY KEY,
  data           jsonb NOT NULL,
  policy_id      text GENERATED ALWAYS AS (data->>'id') STORED,
  autonomy_level text GENERATED ALWAYS AS (data->>'autonomyLevel') STORED
);

CREATE TABLE IF NOT EXISTS agent_runs (
  ord   bigserial,
  id           text PRIMARY KEY,
  data         jsonb NOT NULL,
  agent_type   text GENERATED ALWAYS AS (data->>'agentType') STORED,
  status       text GENERATED ALWAYS AS (data->>'status') STORED,
  shipment_id  text GENERATED ALWAYS AS (data->>'shipmentId') STORED,
  exception_id text GENERATED ALWAYS AS (data->>'exceptionId') STORED,
  started_at   text GENERATED ALWAYS AS (data->>'startedAt') STORED
);
CREATE INDEX IF NOT EXISTS agent_runs_shipment_idx ON agent_runs (shipment_id);

-- Append-only lists (and the keyed tables above) carry `ord` so hydration
-- preserves the working set's insertion order exactly.
CREATE TABLE IF NOT EXISTS agent_steps (
  ord          bigserial,
  id           text PRIMARY KEY,
  data         jsonb NOT NULL,
  agent_run_id text GENERATED ALWAYS AS (data->>'agentRunId') STORED,
  phase        text GENERATED ALWAYS AS (data->>'phase') STORED,
  ts           text GENERATED ALWAYS AS (data->>'timestamp') STORED
);
CREATE INDEX IF NOT EXISTS agent_steps_run_idx ON agent_steps (agent_run_id);

CREATE TABLE IF NOT EXISTS agent_actions (
  ord             bigserial,
  id              text PRIMARY KEY,
  data            jsonb NOT NULL,
  agent_run_id    text GENERATED ALWAYS AS (data->>'agentRunId') STORED,
  tool            text GENERATED ALWAYS AS (data->>'tool') STORED,
  status          text GENERATED ALWAYS AS (data->>'status') STORED,
  idempotency_key text GENERATED ALWAYS AS (data->>'idempotencyKey') STORED
);
CREATE INDEX IF NOT EXISTS agent_actions_run_idx ON agent_actions (agent_run_id);

CREATE TABLE IF NOT EXISTS communications (
  ord          bigserial,
  id           text PRIMARY KEY,
  data         jsonb NOT NULL,
  shipment_id  text GENERATED ALWAYS AS (data->>'shipmentId') STORED,
  agent_run_id text GENERATED ALWAYS AS (data->>'agentRunId') STORED,
  channel      text GENERATED ALWAYS AS (data->>'channel') STORED,
  sent_at      text GENERATED ALWAYS AS (data->>'sentAt') STORED
);
CREATE INDEX IF NOT EXISTS communications_shipment_idx ON communications (shipment_id);

CREATE TABLE IF NOT EXISTS approvals (
  ord   bigserial,
  id           text PRIMARY KEY,
  data         jsonb NOT NULL,
  agent_run_id text GENERATED ALWAYS AS (data->>'agentRunId') STORED,
  shipment_id  text GENERATED ALWAYS AS (data->>'shipmentId') STORED,
  action_type  text GENERATED ALWAYS AS (data->>'actionType') STORED,
  status       text GENERATED ALWAYS AS (data->>'status') STORED,
  created_at   text GENERATED ALWAYS AS (data->>'createdAt') STORED
);
CREATE INDEX IF NOT EXISTS approvals_status_idx ON approvals (status);

CREATE TABLE IF NOT EXISTS audit_log (
  ord          bigserial,
  id           text PRIMARY KEY,
  data         jsonb NOT NULL,
  ts           text GENERATED ALWAYS AS (data->>'timestamp') STORED,
  actor_type   text GENERATED ALWAYS AS (data->>'actorType') STORED,
  actor_id     text GENERATED ALWAYS AS (data->>'actorId') STORED,
  action       text GENERATED ALWAYS AS (data->>'action') STORED,
  entity_type  text GENERATED ALWAYS AS (data->>'entityType') STORED,
  entity_id    text GENERATED ALWAYS AS (data->>'entityId') STORED,
  agent_run_id text GENERATED ALWAYS AS (data->>'agentRunId') STORED
);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log (entity_id);
CREATE INDEX IF NOT EXISTS audit_log_run_idx ON audit_log (agent_run_id);
CREATE INDEX IF NOT EXISTS audit_log_ts_idx ON audit_log (ts);

CREATE TABLE IF NOT EXISTS dispatch_proposals (
  ord   bigserial,
  agent_run_id text PRIMARY KEY,
  data         jsonb NOT NULL,
  driver_id    text GENERATED ALWAYS AS (data->>'driverId') STORED
);
