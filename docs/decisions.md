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

2026-11-17 — Complete the workflow with parallel component images and two balanced E2E stacks — version-2 provenance permits unchanged API/web/migrator reuse while a final identity comparison prevents missing or duplicated regression tests. This supersedes the earlier decision to postpone shards and component releases; complete pipeline gains must be measured from CI receipts.

2026-11-17 — Put the migration CLI in a dedicated image and run approved migrations before application cutover — keeps the runtime smaller, backs up before changing the database and preserves version-1 application rollback. Migrator tags share the existing public API package without replacing runtime tags.

2026-11-17 — Gate heavy PR work on lint/types while keeping stable candidates parallel — avoids spending image-build time on an immediately invalid PR without adding that barrier to stable delivery.

2026-11-17 — Require a bound isolated restore before opt-in artifact retention — protect current/previous releases, legacy pins and container-referenced images; verify backup/source hashes and actual migration history before deleting only allowlisted project artifacts.

2026-11-17 — Fail CI on flaky retries and correlate HTTP 500 responses with opaque error IDs — retained historical evidence does not establish the signup failure's cause; future diagnostics must link the fixture to safe server metadata without logging request identities or credentials.

2026-11-21 — Defer iGPSPORT, Bryton and Magene until direct vendor access is confirmed — match Garmin and Wahoo with mobile authorization and automatic workout delivery through the vendor connection.

2026-11-21 — Offer preset, custom UTC and complete available activity history across connected providers — athletes can recover activities from their vendor account within its API limits, with repeat imports and duplicate protection.

2026-11-21 — Disable built-in AI and external AI agent access in the application — coaches and athletes do not use those features, and the existing data is retained.

2026-11-23 — Reserve Wahoo API capacity for account association and share upstream cooldowns through Redis — historical imports can otherwise consume the app-wide quota used by both workout sync and OAuth profile lookups.
