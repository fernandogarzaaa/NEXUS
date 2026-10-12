# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
- Optional shared-token auth: `NEXUS_ACCESS_TOKEN` + `/login` page; HMAC session cookie (HttpOnly, SameSite=Lax, Secure in production); `proxy.ts` redirects/401s unauthenticated requests and every Server Action calls `assertAuthorized()`.
- Production builds refuse Server Actions when no token is configured unless `NEXUS_ALLOW_UNAUTHENTICATED=1`.
- `npm audit fix` (non-breaking lockfile bumps, incl. source-map-js 1.2.2). Remaining advisories are dev-only via `eslint-config-next` and need a breaking change.

### Added / Changed
- CI workflow (Node 22) running eslint, tsc --noEmit, vitest and next build on pushes to main and pull requests
- Dependabot config for npm and GitHub Actions (weekly)
- .env.example listing ANTHROPIC_API_KEY / ANTHROPIC_MODEL (un-ignored in .gitignore)
- SECURITY.md with private reporting contact
