# Context

Updated: 2026-11-23

## Cycling computer integrations

iGPSPORT, Bryton and Magene are deferred until a direct integration can use
the same athlete experience as Garmin and Wahoo. Athletes authorize their
vendor account on mobile and receive planned workouts automatically. The
Intervals.icu prototype and Windows companion were withdrawn locally before
deployment.

Athletes can request completed activity history from Wahoo, Garmin, Strava,
Suunto, COROS and Polar. The connector offers presets, inclusive UTC dates
and a separate action for all available history. Provider limits apply,
including Garmin's 31-day backfill and Polar's 30-day post-connection feed.
Regular Wahoo sync still covers the last seven days. Repeated requests and
concurrent imports from connected providers use existing activity IDs and
cross-provider duplicate detection.

Wahoo account association shares the provider app quota with background sync. The connector preserves capacity for association and shares upstream reset times across API and worker processes.

## Product features

Built-in AI features and AI agent access are disabled in the installed
application. The code and persisted data are retained for possible future use.

## Workflow follow-up

The 1.8.0 source implements the remaining workflow changes: parallel API/web/migrator images, conservative component reuse, two balanced E2E stacks with complete identity coverage, a PR lint/types barrier, and opt-in artifact retention after an isolated backup restore. Version-2 manifests retain version-1 rollback support. The installed updater must be upgraded as a complete bundle before publication. No schema migration is introduced; optional `SOURCE_CODE_URL` configures the full release source link at web startup. See [component delivery](.github/docs/RELEASE-COMPONENTS.md).

The server receipt and the curated Obsidian project note own the current installed state; this source checkpoint is not deployment proof. Earlier workflow improvements include granular Docker layers, compiled agent tests inside the API image build, cached generated prerequisites, identity/timing receipts, conservative timezone selection, one delivery command and isolated migration/recovery rehearsals.

The responsive statistics benchmark kept all 90 per-run width assertions across two devices and reduced mean wall time from 53.5 to 18.7 seconds (two runs per version in reverse order, same 1.7.2 images). Four read-only locale tests now share one test-owned fixture and retain all route assertions. The full pipeline gain and delivery state must be verified from the current CI and server receipts, not inferred from these local measurements.

The historical signup 500 has no retained internal exception and remains unattributed. A local 140-request signup stress run passed; future HTTP failures get an opaque correlation ID and safe route/status/code metadata. CI now fails on flaky retries. Do not describe the historical failure as fixed without a reproduction and regression proof.

## Current delivery

Tourmalet 1.7.2 addressed the 20 findings from the November code audit: atomic calendar writes, bounded logout, coordinated device exports, explicit public account contracts, scoped calendar caches, module boundaries, shared calculations and unused-code removal. These changes remain included in this source. See [audit follow-up](.github/docs/CODE-AUDIT-2026-11.md) and [decisions](docs/decisions.md).

The earlier workflow improvements merged through PR #7 (`d3b7780`) and PR #9 (`415b898`); component delivery and balanced shards merged through PR #10 (`14a4994`). Stable CI produces candidates tested by digest, and release promotion reuses them without rebuilding. Verification metadata is staged in one flat artifact directory for its downstream consumers. Conservative path selection skips unrelated application work for documentation and marketing changes. See [CI design](.github/docs/CI.md).

## Verification

For the current 1.8.0 preparation, `scripts/verify.sh --all` passed preparation, translations/parity, lint, types, units, all production builds and 18 compiled agent tests, then stopped on five integration failures in four suites (298 passed). Native Windows transaction-start timeouts reproduced with both normal PostgreSQL storage and tmpfs. The complete unchanged integration suite then passed inside the Linux build target against a fresh isolated PostgreSQL: 42 suites, 303 tests, 153.5 seconds Jest time, with public fixtures mounted read-only and guaranteed teardown. This comparison does not establish the historical signup 500's cause. No timeouts or retries were increased.

The subsequent correlation test, API/E2E lint/types, 43 script tests and 50 deployment tests passed; actionlint passed. New production images and their 18 compiled agent tests passed. Local sharded E2E passed 106 + 110 = 216 tests exactly once, with no failures/skips/flaky results; each group used a fresh stack and teardown removed all services. Their test phases took 143.91 and 138.77 seconds sequentially on this machine, not a controlled CI speed comparison. PR #10 also passed all 216 E2E in CI, with 147.64/147.37-second test phases and no retries. Successful exact stable CI, release smoke and a matching server receipt remain mandatory delivery gates. Independent correctness/simplification/specification reviews are clear after explicitly binding the restore receipt to its source checksum.

A real existing pre-upgrade backup was restored on the server into a disposable PostgreSQL with no ports, host mounts or external networking. Its 139 migration names/checksums/states matched the previous source archive and Git tree; backup/source SHA-256 checks passed, all 29 pre-existing containers remained unchanged, and no cleanup was enabled or applied during that check.

## Release and operational limits

No schema migration is required. Follow the [deployment guide](.github/docs/DEPLOYMENT.md): reviewed PR, exact successful stable push CI, annotated version tag, digest promotion, smoke and the updated server bundle. Enable retention only with explicit legacy pins and verified backup/source provenance. The server receipt is authoritative for the currently deployed version; do not infer it from this source file.

External provider calls cannot be made transactional. A crash or lost lease after remote acceptance can leave an ambiguous/repeated/orphaned plan; finite request timeouts and existing reconciliation limit this. Real-device sends were not part of this audit validation.

`tourmalet` is stable; `main` is divergent upstream. Keep secrets and private operational records outside the public repository. Preserve the migration allowlist and rollback behavior.
