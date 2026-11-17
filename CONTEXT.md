# Context

Updated: 2026-11-17

## Goal now

Reduce the time from an application change to a releasable artifact. See [CI design](.github/docs/CI.md) and [decisions](docs/decisions.md).

## Status

Local changes implement conservative job selection, stable production candidates tested by digest, promotion without rebuilding, a short release smoke, focused PR feedback, a session-builder save wait, npm cache cleanup and guaranteed local test-stack teardown.

Workflow verification: actionlint and Bash syntax pass; 14 script tests and 19 deployment tests pass; E2E lint/types and smoke selection (2 tests) pass. The canonical `scripts/verify.sh --e2e` passed preparation, locale parity, lint, types and all 1,034 API tests, then hit a timeout in the existing mobile-version CLI test. The unchanged full web suite passed with `--maxWorkers=2` (777 tests). Docker Desktop did not start within 45 seconds, so image/E2E execution remains a CI gate. Independent correctness/spec review passed; changed-spec-first duplication is intentional for earlier feedback.

The user subsequently requested implementation of the code audit for the deployed version. Its 20 findings are being mapped after this workflow review; no application-code fix or production change has yet been made by this task.

## Next steps

Integrate the reviewed workflow through a PR and required CI, then implement and test the code audit's atomic writes, input/session fixes, queue/export reliability, contract and dependency simplifications, and dead-code cleanup. Deliver through the existing release process. Observe PR/stable/release execution before claiming a measured speedup.

## Open questions

The transient fixture signup 500 has no established cause. Additional timing-based optimizations are deferred as recorded in the CI guide.

## Gotchas

`tourmalet` is stable; `main` is divergent upstream. A release requires an exact successful stable push CI with retained candidate metadata. Missing artifacts fail closed. Server migration approval and rollback behavior remain unchanged. Keep private operational records and credentials outside this public repository.
