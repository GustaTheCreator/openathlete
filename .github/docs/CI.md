# CI and local feedback

## Required checks

`scripts/ci_scope.py` selects checks from the PR merge-base diff or the entire push diff. Renames include both old and new paths. Missing history, manual dispatch, shared packages, root configuration, workflow changes and unknown paths run all checks. `CI passed` rejects failed/cancelled jobs, missing classification and unexpectedly skipped jobs.

| Changed paths | Checks |
| --- | --- |
| `apps/api`, `apps/web`, `e2e` | Lint, types, three timezone unit runs, DB integration, production-image E2E, AI agent build tests |
| `apps/website` | Website lint, types and build, with Next.js build cache |
| `apps/docs` | Standalone docs types and build |
| `VERSION` | Application and deployment/release checks; stable push creates the candidate |
| Allowlisted prose/instruction paths | Classification and aggregate gate |
| Shared/database, infrastructure, scripts, lockfile, unknown paths | All checks |

New/modified PR specs run first in the same isolated stack, then the full regression runs. Separate HTML/JSON reports preserve the early failure. CI and release retain redacted service logs even on success and summarize failed/flaky tests and retry counts. Existing tests keep their retry policy and all assertions. The session-builder tests wait for the server's save response before querying persisted data.

## Build once, release the tested images

The same reusable E2E workflow serves PRs and stable pushes. PR jobs only have read permissions and use local test images. Only `push` on `GustaTheCreator/openathlete`'s `tourmalet` branch gets package-write permission. It pushes unique candidates, pulls their exact digests into the test stack and records metadata after the full suite succeeds. Release validation also requires the whole stable CI run to succeed.

The tag workflow promotes the tested digests and runs a short fresh-stack smoke. It does not rebuild or repeat the complete regression. Metadata binds version, revision and both digests; source archives still come from the annotated tag's exact commit. The server's manifest, migration allowlist, backup and rollback contracts are unchanged.

The separate web build job is removed: Docker E2E proves packaging. The API build job remains because `test:agents` exercises the compiled application module against fake provider APIs. The website is no longer on the critical path of application-only changes. Translation generation is selected by the consuming job.

## Fast development loop

Use Node 22 and pnpm 9.15.9. During edits, run the smallest relevant check first:

```sh
pnpm api test --runInBand --runTestsByPath src/path/to/change.spec.ts
pnpm web exec vitest run src/path/to/change.test.ts
pnpm e2e stack:up
pnpm e2e test:e2e tests/web/session-builder.spec.ts --project desktop
pnpm e2e stack:down
python -m unittest discover -s scripts -p 'test_*.py' -v
```

Paths in the first two commands are placeholders. Rebuild `shared` if changed and generate Prisma/translations when their inputs change. Follow the [verify skill](../../.agents/skills/verify/SKILL.md) before integration. `scripts/verify.sh --e2e` still runs the base suite and now tears down attempted stacks on failure as well as success. Docker tests require a running local Linux engine; never use the shared production host as a build runner.

## Scope and measurements

This change addresses repeated release builds/regression, website/docs coupling, late feedback from changed specs, one confirmed save race, missing release reports, disposable npm cache and incomplete local teardown. It does not claim a measured end-to-end speedup until a new PR, stable CI and release have run.

Further tuning remains evidence-driven: parallel builds/sharding, fewer statistics navigations, shared fixtures, precise Docker COPY layers, timezone reduction, per-component releases, migrator extraction, deploy timing/retention and automatic migration evidence. These are not needed to remove the repeated release build and regression and are not implemented here. The transient signup 500 still needs a reproducible cause; retries were not increased.
