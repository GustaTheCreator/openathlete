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

4. The stable push CI builds the `linux/amd64` API and web candidates, sets their final version/revision labels and source-tag footer, pushes them under unique candidate tags, and runs the full E2E suite against the registry digests. Only after that suite passes does it upload `tourmalet-candidate`. The release validates its version and revision, then adds version/SHA tags to the same digests without rebuilding. Existing tags are accepted only when their digest is identical, allowing a failed promotion to resume without replacing an image.
5. A short smoke job pulls those exact digests into a fresh stack, runs migrations through normal startup, checks service health, exercises account creation/login and checks the source footer. The full regression has already tested these exact images in the successful stable CI. Reports and traces are retained for CI and release failures/retries.
6. After smoke passes, the workflow creates the public `tourmalet-release.json` manifest and the AGPL source archive from that tagged commit. It uploads both to a draft GitHub release, then publishes the release. The manifest pins image digests and includes the migration-tree object ID and source-archive SHA-256.

Do not put `.env` files, server configuration, passwords, API keys, SMTP credentials, or other private data in the repository or container image. Release validation uses the built-in GitHub token with `actions: read` and `contents: read`; only image publishing receives `packages: write`, and only release publishing receives `contents: write`.

Candidate metadata is retained for 30 days. Missing/expired metadata fails closed: do not rebuild in the tag workflow or substitute a PR artifact. Re-run the stable **push** CI for that commit before the first promotion, or prepare a new patch version if version/SHA image tags were already promoted. Documentation-only stable commits intentionally have no candidate; include the release's `VERSION` change before tagging. Re-running a build can produce new digests, so never replace already promoted version/SHA tags with the new candidate.

## Server update and rollback

The Tourmalet server updater reads published GitHub releases and the accompanying manifest. It checks the release version and source checksum, verifies image metadata, and compares the migration tree against the server's explicit allowlist before pulling images or changing services. A migration that is not approved by that allowlist stops deployment.

For an approved release, the updater backs up the database and current source snapshot before changing the Compose image references. It waits for service health and restores the prior application snapshot if activation fails. Database rollback is not automatic: migrations must be reviewed for compatibility, and restoring a database backup is an operator decision because it discards writes made after the backup.

Use the updater's `check`, `status`, `deploy`, and `rollback` commands on the server. `check` validates the latest release without pulling images or changing containers. Keep server paths, environment variables, credentials, and network details in private server configuration; do not copy them into this document or the public repository.
