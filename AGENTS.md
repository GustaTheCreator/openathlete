# OpenAthlete

Open-source (AGPL-3.0) training platform for endurance athletes and coaches. Hosted and self-hosted deployments are both first-class; hosted-only integrations must remain disabled unless configured, and self-hosted instances must not send data to OpenAthlete services.

## Repository map

| Path | Purpose |
| --- | --- |
| `apps/api` | NestJS API and worker; see [API guidance](apps/api/AGENTS.md) |
| `apps/web` | React, Vite and Capacitor app; see [web guidance](apps/web/AGENTS.md) |
| `apps/website` | Next.js marketing site |
| `apps/docs` | Standalone Fumadocs app with its own lockfile |
| `libs/shared` | Shared Zod schemas, DTOs, enums and utilities |
| `libs/database` | Prisma schema and migrations |
| `e2e` | Playwright tests against production Docker images |
| `.agents/skills` | Reusable project workflows |
| `.github/docs` | Deployment, self-hosting, source releases and role policy |

## Commands and verification

Use Node 22 and pnpm 9. First setup: `nvm use && pnpm install`; start local services with `docker compose -f docker-compose.dev.yml up -d`. `pnpm dev` starts API and web.

`scripts/verify.sh` is the standard fast suite (lint, types, unit tests and translation checks). Add `--integration` for database behavior, `--build` for production builds and AI agent checks, or `--e2e` for Docker-backed user flows; `--all` runs all suites. See `.agents/skills/verify/SKILL.md` for selection and limits. `apps/docs` has separate commands documented in its package manifest.

Rebuild `libs/shared` (`pnpm shared build`) before API or web checks when shared code changes. Paraglide output in `apps/web/src/paraglide` is generated; recompile after editing message catalogs. `apps/docs` is standalone and must use pnpm 9.15.9 as pinned in its `packageManager` field.

## Invariants

- No `any`; API request/response contracts live in `libs/shared` as Zod schemas.
- Declare new environment variables in the shared schema, relevant `.env.example`, compose configuration when needed, and `.github/docs/SELFHOSTING-SOURCE.md`.
- Optional integrations initialize lazily and fail cleanly when unconfigured. Self-hosted installations never send data to our services.
- Slow or bulk work runs in BullMQ jobs, not HTTP handlers. Jobs must be idempotent and clear in-progress state after final failure.
- User-facing text uses Paraglide in `en`, `fr`, `it`, `es` and `pt-BR`; run locale parity checks.
- Never log full email addresses; use `maskEmail`. Auth and public write endpoints use `RATE_LIMITS`; signed webhooks and health checks follow existing throttle rules.
- Account erasure goes through `AccountDeletionService`; new related foreign keys need deletion handling and fixture coverage.
- Sports roles are database-backed: signup starts as ATHLETE; authorized coaches or SUPER_ADMIN can issue invitations with only permitted role grants, and a new COACH grant also includes ATHLETE. Only SUPER_ADMIN directly manages account roles. Clients cannot self-promote. SUPER_ADMIN is separate administration and grants no implicit sports-data access. Follow [.github/docs/ROLE-POLICY.md](.github/docs/ROLE-POLICY.md).
- Store and bucket dates in UTC. Tests cover multiple timezones.
- Keep API and web behavior aligned with their local [guidance](apps/api/AGENTS.md) and [guidance](apps/web/AGENTS.md).

## Git and releases

The stable default branch is `tourmalet`; `main` is a divergent upstream branch. Feature branches use `codex/*`. Follow repository conventions and never include secrets, `.env` files, or local `DISCORD_FEEDBACK.md` in commits.

Tourmalet releases use `VERSION`, annotated `tourmalet-vMAJOR.MINOR.PATCH` tags, and `.github/workflows/tourmalet-release.yml`. Follow the canonical [deployment and release guide](.github/docs/DEPLOYMENT.md). Upstream `v*` mobile releases are separate and are not the default release path. Reading a release or PR skill does not authorize external actions; obtain explicit task authorization before publishing, merging, approving CI, posting or changing a live system.

## Skills

Load the relevant `.agents/skills/<name>/SKILL.md` for its reusable workflow: `verify`, `e2e`, `api-endpoint`, `prisma-migration`, `i18n`, `review-pr`, `triage-feedback`, or `release`. Each workflow defines a `Handoff:` section for escalation or completion.
