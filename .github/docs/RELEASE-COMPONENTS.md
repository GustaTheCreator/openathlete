# Component delivery contract

Tourmalet 1.8 introduces a version-2 manifest while keeping version-1 releases readable for rollback. A release still has one immutable version, annotated tag, source archive and exact successful stable push CI. Its API, web and migrator images can have older component revisions only when their complete build inputs are identical.

## Provenance

The candidate records `schemaVersion`, `version`, `revision`, `images` and `components`. Each of `api`, `web` and `migrator` has an immutable registry digest plus component `revision`, `version` and SHA-256 `inputs` metadata. Build inputs include the Dockerfile/target, dependency manifests/lockfile, relevant source trees and the input-selection policy. Missing metadata, unknown policy, changed inputs or unavailable ancestry force a build. Version-1 images are never reused as version-2 components.

Only protected stable push CI publishes candidates. PRs use local image archives in Actions artifacts and retain read-only registry permissions. All three images build independently; two isolated E2E stacks consume the exact resulting images. Historical test durations balance the shards, and a final identity check requires the reports to cover every discovered test exactly once. Candidate metadata is uploaded only after those checks pass.

The release promotes all three tested digests without rebuilding. Component labels must match their own recorded revision/version/input hash, and the component revision must be an ancestor of the release with identical current inputs. New version tags may reference unchanged older components; existing version/SHA tags remain immutable.

The migrator is a distinct image in the existing public API registry package, with `migrator-<version>` and `migrator-sha-<revision>` tags. It never replaces API tags or requires a new package visibility/authentication setup. Component input labels distinguish its digest from the API runtime digest.

## Runtime and migration

The web image reads the full release's source URL from an index meta tag set at startup. Reuse never rewrites long-cached JavaScript assets. Native/hosted builds keep their existing build-time fallback.

The API runtime contains its generated Prisma client but no global migration CLI. A separate migrator image contains the matching schema, migrations and Prisma CLI. Source-build and E2E Compose run it before the API. Published upstream Compose remains compatible with its existing upstream images.

The updater accepts both manifest versions. It validates/pulls images and saves a database backup before running an approved changed migration tree with the dedicated migrator. Only the database connection reaches that short-lived container. The migration allowlist remains an operator decision. Failed migrations stop before application cutover and reject automatic retry; rollback never restores a database over newer writes.

The updater recreates the API only when its image changes. Web startup may still change to refresh the full source URL even when its image is reused. Current/previous application receipts and all unrelated services/configuration are preserved.

## Fast failure and retention

PR image work waits for lint and type checks; stable candidates remain parallel with their mandatory checks. This avoids expensive PR work after a quick failure without serializing every stable release.

Automatic retention is opt-in in private operator configuration, preserves current/previous releases and explicit legacy pins, and requires a successful isolated restore check bound to the current backup SHA and migration tree. It removes only allowlisted project-owned artifacts and never runs global Docker pruning. A production restore check uses no host ports, mounts or external network and emits no row data.
