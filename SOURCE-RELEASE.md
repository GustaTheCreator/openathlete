# Corresponding source

Current releases use `VERSION`, annotated `tourmalet-vMAJOR.MINOR.PATCH` tags, and an accompanying source archive and digest manifest. See [DEPLOYMENT.md](DEPLOYMENT.md). The installed footer links to the exact release tag used to build that image.

The earlier hardening release remains available as `tourmalet-2026.11.16.1` in [GustaTheCreator/openathlete](https://github.com/GustaTheCreator/openathlete/tree/tourmalet-2026.11.16.1); its tag is retained unchanged.

Base: upstream OpenAthlete v1.6.0. This fork adds bidirectional Wahoo synchronization, the instance footer and the security changes described in `SECURITY.md`. The source includes application code, dependency lockfile, migrations and Docker build recipes. Runtime credentials, databases, backups and personal operational notes are excluded.

Build instructions: `SELFHOSTING-SOURCE.md`. License: `LICENSE` (AGPL-3.0-only). The installed web application's source link opens the corresponding GitHub release tag.
