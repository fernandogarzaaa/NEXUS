# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added / Changed
- CI workflow (Node 22) running eslint, tsc --noEmit, vitest and next build on pushes to main and pull requests
- Dependabot config for npm and GitHub Actions (weekly)
- .env.example listing ANTHROPIC_API_KEY / ANTHROPIC_MODEL (un-ignored in .gitignore)
- SECURITY.md with private reporting contact
