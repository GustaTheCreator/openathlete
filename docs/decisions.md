# Decisions

2026-11-17 — Build production candidates in stable push CI and promote the tested digests without rebuilding — removes duplicate release builds and full regression while binding publication to the exact successful stable commit; PR tokens remain read-only.

2026-11-17 — Select CI by conservative path groups and enforce selected jobs in `CI passed` — documentation and marketing changes avoid unrelated application work; shared, infrastructure and unknown changes retain full coverage.

2026-11-17 — Keep complete PR/stable regression, timezone coverage and AI build tests — eliminate duplicate work without weakening behavioral or compiled-module checks.

2026-11-17 — Commit calendar writes together and serialize device exports — database transactions prevent partial saves; post-commit notifications avoid publishing rolled-back changes. A renewable per-workout Redis lease coordinates API and worker exports without holding a database transaction during network calls.

2026-11-17 — Define public user fields explicitly and keep workout persistence mapping in the API — adding a private database field must not silently expand the frontend contract.

2026-11-17 — Run compiled AI agent tests inside the API image build and copy build inputs by dependency — removes a separate API compilation while keeping the 18 fake-provider/module checks on the output used by the runtime image; unrelated source edits no longer invalidate Prisma/shared layers.

2026-11-17 — Cold-load each statistics route once, then test all responsive widths by resizing — preserves 45 assertions per device and cuts the controlled two-device test from 53.5 to 18.7 seconds wall time; at least one initial load remains covered per route.

2026-11-17 — Restrict timezone reduction to inert web assets — all application logic, mixed, shared/database and unknown changes retain UTC/New York/Tokyo; styles/images/fonts alone have no date-bucketing behavior.

2026-11-17 — Keep CI heavy jobs parallel and server polling unchanged until further measurement — a universal static-check barrier adds 60–78 seconds to green runs, and polling was not the bottleneck; optimize the measured E2E work before adding shards, component provenance or a separate migrator.

2026-11-17 — Prioritize changed E2E specs and run the inverse selection afterward — preserves the complete regression while avoiding duplicate execution of expensive changed tests; discovery verified all 216 test identities are covered exactly once (22 prioritized, 194 remaining).
