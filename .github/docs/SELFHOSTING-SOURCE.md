# Build this fork

This fork is based on OpenAthlete v1.6.0. Use the exact tag linked by the installed footer to obtain its corresponding source. New releases use annotated `tourmalet-vMAJOR.MINOR.PATCH` tags; the earlier `tourmalet-2026.11.16.1` tag is retained. The upstream AGPL-3.0 license remains in [LICENSE](../../LICENSE). Run the commands below from the repository root. For normal server updates, follow [DEPLOYMENT.md](DEPLOYMENT.md).

Use Node 22.23.4 and pnpm 9.15.9, or the supplied Dockerfiles with pinned base images. Generate your own credentials in private environment files; example values are not deployment credentials. Keep databases, backups, tunnel credentials and personal project notes outside Git and Docker build contexts.

For a local build:

```sh
pnpm install --frozen-lockfile
pnpm database run db:generate
pnpm shared build
pnpm api build
pnpm web build
```

For a container build, first configure your private `.env` using the upstream self-hosting instructions. Set `APP_URL` to the exact browser address, use HTTPS for public access, and set `SIGNUP_MODE=invite`. Create the first account privately before exposing a fresh installation. Arbitrary/local AI endpoints are disabled by default; leave `AI_ALLOW_CUSTOM_ENDPOINTS=false` on a public instance.

Supply your own privacy page at `public-privacy/index.html`, identifying your actual operator and data practices. It is mounted read-only at `/privacidade/`; the team's deployment-specific policy and configuration are not part of this repository.

```sh
docker compose -f docker-compose.yml -f selfhost/docker-compose.source.yml build api web
docker compose -f docker-compose.yml -f selfhost/docker-compose.source.yml up -d
```

The application contains the source link in its React footer. No startup script or injected floating link is required. The link opens this fork's release tag on GitHub.

New accounts start as ATHLETE. Before issuing invitations on a fresh instance,
follow [the initial administrator procedure](ROLE-POLICY.md#first-super-administrator)
to preview and grant the intended operator ATHLETE + COACH + SUPER_ADMIN by exact
ID and email. Signup and onboarding cannot grant those privileges. Existing
coach-only accounts have a separate preview-first repair; no migration promotes
or repairs accounts automatically.

See [SECURITY.md](../SECURITY.md) for session changes, the remaining tooling advisory and reporting instructions. Before upgrades, back up the database and private configuration and test migrations against an isolated copy. The session migration is additive, but legacy session JWTs are rejected and users must sign in again.

Native mobile publishing is separate from these server containers. Its unresolved CocoaPods/ActiveSupport advisory is documented in [SECURITY.md](../SECURITY.md); no native app binaries are published by this server release.
