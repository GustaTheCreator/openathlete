# Tourmalet deployment and release process

Tourmalet runs the public OpenAthlete fork from `GustaTheCreator/openathlete`. Development happens on short-lived `codex/*` branches and merges into the stable `tourmalet` branch through pull requests. The upstream `main` branch and its `v*` release process remain separate.

## Checks

GitHub Actions runs lint, type checks, the unit suite in three time zones, database integration tests, documentation checks, end-to-end tests, application builds, deployment tests, and release-helper tests. The stable branch protection should require the single `CI passed` check, which succeeds only when every job succeeds. Before building release images, the tag workflow verifies that a successful `push` CI run exists for the exact commit on `tourmalet`; it does not repeat the full CI run.

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

4. After finding the successful stable-branch CI run, GitHub Actions builds and publishes `linux/amd64` API and web images to GHCR, tagged by version and commit SHA. The web image links its footer to the source tree for that exact tag.
5. A smoke job pulls those exact image digests and runs the end-to-end suite against them, without rebuilding the images. The regular CI end-to-end job also builds its own test images; keeping both checks costs extra runner time but verifies both the usual CI build and the exact published artifacts.
6. After smoke passes, the workflow creates the public `tourmalet-release.json` manifest and the AGPL source archive from that tagged commit. It uploads both to a draft GitHub release, then publishes the release. The manifest pins image digests and includes the migration-tree object ID and source-archive SHA-256.

Do not put `.env` files, server configuration, passwords, API keys, SMTP credentials, or other private data in the repository or container image. Release validation uses the built-in GitHub token with `actions: read` and `contents: read`; only image publishing receives `packages: write`, and only release publishing receives `contents: write`.

## Server update and rollback

The Tourmalet server updater reads published GitHub releases and the accompanying manifest. It checks the release version and source checksum, verifies image metadata, and compares the migration tree against the server's explicit allowlist before pulling images or changing services. A migration that is not approved by that allowlist stops deployment.

For an approved release, the updater backs up the database and current source snapshot before changing the Compose image references. It waits for service health and restores the prior application snapshot if activation fails. Database rollback is not automatic: migrations must be reviewed for compatibility, and restoring a database backup is an operator decision because it discards writes made after the backup.

Use the updater's `check`, `status`, `deploy`, and `rollback` commands on the server. `check` validates the latest release without pulling images or changing containers. Keep server paths, environment variables, credentials, and network details in private server configuration; do not copy them into this document or the public repository.
