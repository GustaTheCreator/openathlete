# Context

Updated: 2026-11-17

## Current delivery

Tourmalet 1.7.2 addresses the 20 November code-audit findings: atomic calendar writes, bounded logout, coordinated device exports, explicit public account contracts, scoped calendar caches, module boundaries, shared calculations and unused-code removal. See [audit follow-up](.github/docs/CODE-AUDIT-2026-11.md) and [decisions](docs/decisions.md).

The workflow improvement merged through PR #7 (`d3b7780`); PR and stable CI passed. Stable CI produces candidates tested by digest, and release promotion reuses them without rebuilding. Conservative path selection skips unrelated application work for documentation and marketing changes. See [CI design](.github/docs/CI.md).

## Verification

Local preparation, translations, locale parity, lint, types, 1,924 unit tests, API/web/website builds and 18 compiled agent tests passed. The canonical `scripts/verify.sh --build` was resumed at lint after formatting corrections, using its same remaining commands.

All 303 PostgreSQL integration tests were covered: 39 suites passed in the full run; three setup/connection-timeout suites passed unchanged when repeated alone after the website build finished. Docker Desktop was unavailable locally, so production-image browser regression remains a required CI gate. Independent correctness, simplification and specification reviews completed; the actionable findings were corrected and re-reviewed. The staged secret scan passed.

## Release and operational limits

No schema migration or new environment variable is required. Follow the [deployment guide](.github/docs/DEPLOYMENT.md): reviewed PR, exact successful stable push CI, annotated version tag, digest promotion, smoke and server updater. The server receipt is authoritative for the currently deployed version; do not infer it from this source file.

External provider calls cannot be made transactional. A crash or lost lease after remote acceptance can leave an ambiguous/repeated/orphaned plan; finite request timeouts and existing reconciliation limit this. Real-device sends were not part of this audit validation.

`tourmalet` is stable; `main` is divergent upstream. Keep secrets and private operational records outside the public repository. Preserve the migration allowlist and rollback behavior.
