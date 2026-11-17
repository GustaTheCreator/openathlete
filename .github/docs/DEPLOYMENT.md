# Tourmalet deployment and release process

Tourmalet runs the public OpenAthlete fork from `GustaTheCreator/openathlete`. Development happens on short-lived `codex/*` branches and merges into the stable `tourmalet` branch through pull requests. The upstream `main` branch and its `v*` release process remain separate.

## Branches and cleanup

- `tourmalet` is the protected default and stable branch. Deployment installs a
  published release from it, pinned by digest, rather than the branch working tree.
- `main` retains upstream development. Updating the fork from upstream is a
  separate reviewed change; do not merge divergent upstream work just to rename
  the production branch.
- `codex/*` branches contain work in progress. After integration, remove a source
  branch only when authorized and after checking that it contains no unique work.
  Squash merges retain different commit IDs, so verify the merged PR and content
  instead of relying only on `git branch --merged`.

## Checks

GitHub Actions selects checks conservatively from changed paths. Application changes run lint, type checks, the unit suite in three time zones, database integration tests, production-image end-to-end tests and the AI agent build tests. The standalone docs and marketing website have separate checks. Shared libraries, lockfiles, workflows and unknown paths select everything. See [CI and local feedback](CI.md).

Branch protection should require the single `CI passed` check. It requires successful path classification and every selected check; only deliberately unselected jobs may be skipped. Before promoting release images, the tag workflow requires a successful `push` CI run for the exact commit on `tourmalet` and downloads that run's tested candidate metadata. A PR or manual run cannot supply production candidates.

If an expected PR run is missing, the same CI workflow also supports manual
dispatch with `gh workflow run ci.yml --ref <branch>`. Check that the run uses
the intended commit. Manual runs do not replace the successful stable-branch
`push` run required by the release workflow.

Run the release helper tests locally with:

```sh
python -m unittest discover -s scripts -p 'test_*.py' -v
```

Deployment code has its own checks:

```sh
python -m unittest discover -s deploy -p 'test_*.py' -v
```

## Creating a Tourmalet release

1. Update `VERSION` to a new stable `MAJOR.MINOR.PATCH` value in the reviewed change.
2. Merge the reviewed change into `tourmalet` and wait for `CI passed` on that exact commit.
3. From the tested commit on `tourmalet`, create and push an annotated tag matching `tourmalet-v<VERSION>`:

   ```sh
   version=$(cat VERSION)
   git tag -a "tourmalet-v$version" -m "Tourmalet $version"
   git push origin "tourmalet-v$version"
   ```

   The workflow rejects a tag that does not match `VERSION`, is not annotated, points to another commit, or whose commit is not reachable from `origin/tourmalet`. It also requires a successful `push` CI run for that exact commit on `tourmalet`. Do not move or reuse a release tag. The `tourmalet-v` prefix keeps this workflow separate from the upstream `v*` publisher.

4. Stable push CI prepares `linux/amd64` API, web and migrator candidates in parallel. An unchanged component can reuse a previous version-2 release digest after complete input-hash, ancestry and image-label checks. New builds use unique candidate tags. Two isolated E2E stacks test the exact resulting images and a final check requires every discovered test exactly once. Only then is `tourmalet-candidate` uploaded. The release validates the release and component identities, then adds version/SHA tags to those digests without rebuilding. Migrator tags use `migrator-<version>` and `migrator-sha-<revision>` in the API registry package. Existing tags are accepted only with identical digests. See [the component contract](RELEASE-COMPONENTS.md).
5. A short smoke job pulls those exact digests into a fresh stack, runs the dedicated migrator before the API, checks service health, exercises account creation/login and checks the full release's source footer. When the migration tree differs from the previous published stable manifest, the job also rehearses upgrade and backup restoration against disposable PostgreSQL containers with synthetic data. It never changes the server's migration allowlist. Reports, phase timings, identity receipts and traces are retained; flaky retry results fail CI.
6. After smoke passes, the workflow creates the public version-2 `tourmalet-release.json` manifest and AGPL source archive from that tagged commit. It uploads both to a draft GitHub release, then publishes the release. The manifest pins all three digests, each component's own version/revision/input hash, the migration-tree object ID and source-archive SHA-256. An unchanged web component receives the full release source URL through an index meta tag at startup.

Do not put `.env` files, server configuration, passwords, API keys, SMTP credentials, or other private data in the repository or container image. Release validation uses the built-in GitHub token with `actions: read` and `contents: read`; only image publishing receives `packages: write`, and only release publishing receives `contents: write`.

Candidate metadata is retained for 30 days. Missing/expired metadata fails closed: do not rebuild in the tag workflow or substitute a PR artifact. Re-run the stable **push** CI for that commit before the first promotion, or prepare a new patch version if version/SHA image tags were already promoted. Documentation-only stable commits intentionally have no candidate; include the release's `VERSION` change before tagging. Re-running a build can produce new digests, so never replace already promoted version/SHA tags with the new candidate.

## Server update and rollback

The Tourmalet server updater reads published GitHub releases and the accompanying manifest. It checks the release version and source checksum, verifies image metadata, and compares the migration tree against the server's explicit allowlist before pulling images or changing services. A migration that is not approved by that allowlist stops deployment.

For an approved release, the updater backs up the database and current source snapshot. For version-2 releases it runs the dedicated migrator before application cutover when transitioning from version 1 or changing the approved migration tree. That short-lived container receives only the database connection and disabled telemetry. A failed migration rejects automatic retry and stops before cutover. The updater recreates the API only when its actual image changes; web startup can still refresh the release source URL. It waits for service health and restores the prior application snapshot if activation fails. Database rollback is not automatic: restoring a backup is an operator decision because it discards newer writes.

Use the updater's `check`, `status`, `deploy`, and `rollback` commands on the server. `check` validates the latest release without pulling images or changing containers. Keep server paths, environment variables, credentials, and network details in private server configuration; do not copy them into this document or the public repository.

`status` verifies the running API/web image IDs against the recorded digest references and waits for actual service health. It fails on drift or unhealthy services and shows a retention preview when enabled. Version-1 releases remain readable for application rollback. Before the first version-2 release, install the complete tested updater bundle (`deployer.py` and its sibling modules), verify `status`, then switch the wrapper atomically. Replacing only the old single-file controller is insufficient. Preserve the previous bundle, wrapper and private configuration as the controller recovery path; an old controller cannot read the new retention configuration.

Automatic retention is disabled by default. Its optional private configuration contains `enabled`, `keep` and `pins`; the example keeps five artifacts per category. When enabling it on an existing installation, pin all legacy recovery artifacts that must remain available. Current/previous receipts, explicit pins, the newest configured number of owned backups/source archives/images and images referenced by any container are protected. Tagged or ambiguous images and unrelated paths are excluded; no global Docker prune runs.

After a healthy deployment, cleanup first restores that deployment's pre-upgrade backup into an isolated PostgreSQL container without host mounts, ports or external networking. It verifies the backup SHA-256, the previous source archive's checksum and migration tree, and the restored migration names/checksums/completion states. Unknown legacy provenance or a failed restore disables cleanup. Only a successful bound restore permits removal of the exact allowlisted candidates, rechecked before deletion. Cleanup failure is reported without rolling back a healthy application. `status` never deletes artifacts.

Receipts record monotonic durations for release validation, pulls, image verification, source download/verification, snapshot, database backup, dedicated migration, container activation and health wait. Legacy migration timings come from entrypoint log pairs and overlap startup; they must not be summed as a separate phase. Missing optional timing does not roll back a healthy deployment. These durations do not measure user-visible downtime.

## Isolated migration and recovery rehearsal

Use immutable migrator image references from version-2 manifests or tested candidates; a version-1 baseline can use its API image:

```sh
python deploy/rehearse.py --base-image "$BASE_IMAGE" \
  --candidate-image "$CANDIDATE_MIGRATOR_IMAGE" --json-output rehearsal.json
```

The command requires Docker and the image revisions in local Git history. It creates its own internal network and two disposable PostgreSQL containers, applies baseline migrations, inserts a public synthetic sentinel, makes a dump, runs candidate migrations, restores the dump into an empty database and repeats the upgrade. It verifies the fixture and migration state, records image/revision/tree/checksum results and removes only resources it created. It never reads the server configuration, connects to the production database or grants migration approval.

Using an unchanged tree or the same image is a recovery positive control; it does not validate a changed schema or real production data. A migration-bearing release still needs review of data compatibility and, where required, an operator-controlled rehearsal on an appropriately protected restored copy before approving its tree.

## One delivery command

After a reviewed PR contains the intended `VERSION`, preview the delivery:

```sh
python scripts/deliver.py --pr 123 --receipt delivery.json
```

For an already authorized publication, add `--apply`. The command pins the PR head, waits for `CI passed`, squashes that exact head, waits for a successful stable **push** CI for the resulting commit, validates its candidate, creates an annotated immutable version tag and waits for the published release/manifest. It can resume a matching merged PR or tag; failures never move tags or replace image identities. It does not edit source or versions for the operator.

An authorized server update can use the existing updater through runtime arguments:

```sh
python scripts/deliver.py --pr 123 --apply --receipt delivery.json \
  --ssh-target "$DEPLOY_SSH_ALIAS" --deploy-command "$DEPLOY_UPDATER_COMMAND"
```

Upgrade the installed updater from the tested revision before using this option: the delivery command requires its fresh runtime-verification marker, not just an old saved receipt. Keep aliases and executable paths in private operational instructions. The command verifies the installed version/revision/digests against the tested candidate; the updater preserves its backup, approval, health and rollback guards. The JSON delivery receipt is the common technical record; Obsidian records decisions and any remaining limits without copying secrets.
