# Decisions

2026-11-17 — Build production candidates in stable push CI and promote the tested digests without rebuilding — removes duplicate release builds and full regression while binding publication to the exact successful stable commit; PR tokens remain read-only.

2026-11-17 — Select CI by conservative path groups and enforce selected jobs in `CI passed` — documentation and marketing changes avoid unrelated application work; shared, infrastructure and unknown changes retain full coverage.

2026-11-17 — Keep complete PR/stable regression, timezone coverage and AI build tests — eliminate duplicate work without weakening behavioral or compiled-module checks.

2026-11-17 — Commit calendar writes together and serialize device exports — database transactions prevent partial saves; post-commit notifications avoid publishing rolled-back changes. A renewable per-workout Redis lease coordinates API and worker exports without holding a database transaction during network calls.

2026-11-17 — Define public user fields explicitly and keep workout persistence mapping in the API — adding a private database field must not silently expand the frontend contract.
