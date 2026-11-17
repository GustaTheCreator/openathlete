# Decisions

2026-11-17 — Build production candidates in stable push CI and promote the tested digests without rebuilding — removes duplicate release builds and full regression while binding publication to the exact successful stable commit; PR tokens remain read-only.

2026-11-17 — Select CI by conservative path groups and enforce selected jobs in `CI passed` — documentation and marketing changes avoid unrelated application work; shared, infrastructure and unknown changes retain full coverage.

2026-11-17 — Keep complete PR/stable regression, timezone coverage and AI build tests — eliminate duplicate work without weakening behavioral or compiled-module checks.
