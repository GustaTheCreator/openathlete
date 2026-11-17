# Code audit follow-up

The November 2026 audit covers revision `659c130`. The fixes target Tourmalet 1.7.2; no database migration or new environment variable is required.

| Findings | Change | Verification |
| --- | --- | --- |
| 1–4 | Event/workout edits, complete copies, series updates and MCP batch creation commit together. Notifications and export requests run after commit. Planned copies reuse `copyOf`. | PostgreSQL failure injection in an intermediate write, unchanged originals, no partial copies, no premature notifications. |
| 5 | MCP pace must be positive; converted steps satisfy the shared workout schema. | Zero-pace rejection and existing conversion tests. |
| 6 | The whole logout flow, including refresh, has a five-second bound. Aborted or queued refreshes cannot restore local tokens. | Hung/late refresh, browser lock and refreshed-session revocation tests. |
| 7 | Single and bulk imports share job preparation and propagate Redis failures. | Failed job lookup/state/removal tests. |
| 8 | Export creation, date changes and deletion share a renewable Redis lease per workout, across API/worker processes. | Concurrent calls, lease loss/recovery and owner-checked release tests. |
| 9–11 | One invitation lifetime; queue producers are separate from processors; Subscription uses the stateless authorization guard without importing Auth. | Existing invitation tests, API build and agent/module bootstrap tests. |
| 12 | Public user fields are explicit; Prisma workout persistence mapping belongs to the API. | Public contract tests, mapping tests, shared/API/web type checks. |
| 13–14 | Calendar dates drive query keys without redundant refetch effects; optimistic writes respect each cached date/athlete scope. | Disjoint windows, athlete scope and replacement/rollback tests. |
| 15, 19 | Shared grade math; corrected legacy pace conversion. | Numeric regression tests, including 1 km in 300 seconds = 5 min/km. |
| 16–18 | Remove the unused chat renderer and eight unused hook wrappers, keeping active rendering, HTTP message fallback and backend endpoints. | Callsite searches, web types/build and existing tests. |
| 20 | Wahoo Swagger describes the required state and PKCE verifier. | Contract comparison with the validated callback DTO. |

## Operational limits

The export lease prevents concurrent callers from creating the same workout in normal operation. A process crash after a provider accepts a request but before its identifier is persisted remains ambiguous when that provider has no idempotency key. A remote request accepted after lease loss can also leave a plan behind after a concurrent deletion. Lease expiry permits recovery; it cannot make an external service transactional. Existing provider reconciliation remains in place, and HTTP timeouts bound normal requests well below the lease duration.

Post-commit notifications and derived load estimation retain their existing best-effort behavior. All callbacks are attempted even when one fails; a post-save failure explicitly reports the committed event IDs and tells the caller not to recreate them. The transaction covers primary database writes, not delivery to devices or websocket clients.

Release evidence belongs in the PR and CI runs. This document describes the changes and required checks; it is not a claim that a release is deployed.
