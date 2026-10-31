# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
- `next` 16.3.8 -> 16.4.3 (pinned): fixes GHSA advisories for unauthenticated
  RCE in the Image Optimization API with SVGs, RCE in `use cache` functions
  returning typed arrays, and a Server Actions DoS (all `>=16.0.0 <=16.4.0`).
- `zod` -> ^4.6.7: fixes memory exhaustion when validating oversized
  constrained collections (`<4.6.6`). `npm audit --omit=dev` is now clean.

### Added
- `StateRepository` interface (`lib/domain/repository.ts`) extracted from the
  in-memory store; `lib/domain/store.ts` is now a facade with `loadState()` /
  `persistState()` in addition to `getState()` / `resetState()`. In-memory
  stays the default and is behaviourally unchanged.
- Postgres backend behind `NEXUS_STATE_BACKEND=postgres` + `DATABASE_URL`
  (`lib/domain/postgresRepository.ts`): canonical records as `jsonb` with
  generated, indexed columns; insertion order preserved; incremental persist
  for append-only tables. `npm run db:migrate` applies `db/migrations/*.sql`;
  `npm run db:seed [-- --force]` loads the deterministic demo set. An empty
  migrated database is seeded on first request.
- Pages hydrate the working set before reading; every Server Action hydrates
  before and flushes after its mutation (both no-ops in memory).
- Postgres integration tests (skipped unless `NEXUS_TEST_DATABASE_URL` is
  set); CI now runs them against a `postgres:16` service.
- Read-only external adapter seam (`lib/adapters/`): Zod canonical schemas
  (`lib/domain/schemas.ts`), a dependency-free CSV parser, a GET-only REST
  adapter with env-sourced bearer auth and pagination, a declarative mapping
  file (`from` / `template` / `const` / `map` / `transform` / nested
  `object`), and a reconciliation report (matched with differences,
  unmatched, missing in source, duplicate source ids, duplicate canonical
  ids, quarantined rows with missing fields). `npm run reconcile`. A generic
  example lives in `adapters/generic/` because no Senor system name was
  supplied.
- Public read-only API under `/api/v1` (summary, shipments, shipment detail,
  drivers, vehicles, facilities, exceptions, approvals, policies, agent runs,
  audit, health) with scoped API keys (`NEXUS_API_KEYS`, `NEXUS_TENANT_ID`),
  constant-time secret comparison, tenant binding, pagination and filters.
  Every request with a recognised key is audited through the tool layer
  (`recordApiAccess`). `proxy.ts` leaves `/api/v1/*` to key auth.
- Legacy migration harness, dry run only (`lib/migration/harness.ts`,
  `npm run migrate:dry-run`): read-only source snapshot (SHA-256, optional
  local copy), mapping to canonical types, per-entity counts, duplicates
  (never merged; every member quarantined, identical vs conflicting),
  missing fields, dangling references, quarantined rows with reasons, and
  would-create / would-update (field diffs) / unchanged classification
  against the current store. No write path to the source or the store.

## [0.2.1] - 2026-10-13

### Fixed
- A production build started without `NEXUS_ACCESS_TOKEN` (and without
  `NEXUS_ALLOW_UNAUTHENTICATED=1`) rendered every page normally, but every button
  failed with "Your session may have expired; reload and try again" because
  production redacts the server-side reason. The layout now shows a read-only
  notice naming the two settings, so the cause is visible before anyone clicks.
- `package.json` version was still 0.1.0 at the v0.2.0 tag; versions are now in
  step (0.2.1).

## [0.2.0] - 2026-10-13

### Security
- Optional shared-token auth: `NEXUS_ACCESS_TOKEN` + `/login` page; HMAC session cookie (HttpOnly, SameSite=Lax, Secure in production); `proxy.ts` redirects/401s unauthenticated requests and every Server Action calls `assertAuthorized()`.
- Production builds refuse Server Actions when no token is configured unless `NEXUS_ALLOW_UNAUTHENTICATED=1`.
- `npm audit fix` (non-breaking lockfile bumps, incl. source-map-js 1.2.2). Remaining advisories are dev-only via `eslint-config-next` and need a breaking change.

### Added / Changed
- CI workflow (Node 22) running eslint, tsc --noEmit, vitest and next build on pushes to main and pull requests
- Dependabot config for npm and GitHub Actions (weekly)
- .env.example listing ANTHROPIC_API_KEY / ANTHROPIC_MODEL (un-ignored in .gitignore)
- SECURITY.md with private reporting contact
