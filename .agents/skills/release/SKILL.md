---
name: release
description: Prepare and verify a Tourmalet OpenAthlete release, including versioning, release checks and self-hosting notes. Use when asked to prepare or execute a release.
---

# Release

The active stable branch is `tourmalet`; `main` is a divergent upstream branch. Tourmalet releases use `VERSION`, annotated `tourmalet-vMAJOR.MINOR.PATCH` tags and `.github/workflows/tourmalet-release.yml`. Read [.github/docs/DEPLOYMENT.md](../../../.github/docs/DEPLOYMENT.md) for the canonical release procedure and self-hosting impact. Do not duplicate its steps here.

The upstream `v*` mobile release workflow is separate and is not the default release path. Use it only when specifically asked to release upstream mobile artifacts.

For preparation, inspect the current branch, version, change summary, migration and environment impact, then run the verification required by the canonical guide. Build a concise draft of release notes with upgrade implications. Stop for maintainer review before any external or live mutation. This skill being loaded does not authorize GitHub queries that approve CI, tag/push, publishing, mobile promotion, public announcements or production changes; each requires explicit task authorization.

## Handoff:

Return readiness evidence, proposed version, verification outcomes and draft notes for maintainer review. Do not perform release side effects without explicit authorization.
