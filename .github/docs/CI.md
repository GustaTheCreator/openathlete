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

New/modified PR specs run first in the same isolated stack, then the full regression runs. Separate HTML/JSON reports preserve the early failure. CI and release retain redacted service logs even on success. A `verification-receipt.json` and the job summary contain revision/version, image digests, failed/flaky/skipped counts, retries and available job/step timings. Test payloads and service logs are not copied into the receipt. Existing tests keep their retry policy and all assertions. The session-builder tests wait for the server's save response before querying persisted data.

Three timezone unit runs remain mandatory for application logic, shared/database, unknown paths and mixed changes. Only changes consisting entirely of inert web styles/images/fonts use UTC alone; all other application checks, including E2E, remain selected for those changes.

## Build once, release the tested images

The same reusable E2E workflow serves PRs and stable pushes. PR jobs only have read permissions and use local test images. Only `push` on `GustaTheCreator/openathlete`'s `tourmalet` branch gets package-write permission. It pushes unique candidates, pulls their exact digests into the test stack and records metadata after the full suite succeeds. Release validation also requires the whole stable CI run to succeed.

The tag workflow promotes the tested digests and runs a short fresh-stack smoke. It does not rebuild or repeat the complete regression. Metadata binds version, revision and both digests; source archives still come from the annotated tag's exact commit. The server's manifest, migration allowlist, backup and rollback contracts are unchanged.

Both standalone application build jobs are removed: Docker E2E proves packaging, and the API build stage runs all 18 `test:agents` tests against its own compiled output before producing the runtime image. Fake provider APIs do not contact real devices or need a database. A failed agent test fails the image build and therefore the required E2E/candidate check.

Docker copies database, shared and application sources immediately before their consuming build steps. API-only edits no longer invalidate Prisma/shared compilation; web-only edits no longer invalidate the shared build. Existing GHA layer caches retain dependency installs across ephemeral runners; no unsupported cache-mount persistence or arbitrary pruning of the pnpm store is assumed. The setup action separately caches generated Prisma/shared outputs by their full source, dependency, runtime and platform inputs. It uses exact keys without partial fallback. Image builds do not consume those host-generated outputs.

The website is no longer on the critical path of application-only changes. Translation generation is selected by the consuming job.

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

## Measurements and remaining experiments

The successful 1.7.2 stable baseline (`44121751324`) spent 727 seconds in the candidate/E2E job: API build 132 seconds, web build 105 seconds, browser installation 31 seconds, stack startup 38 seconds and regression 346 seconds. The separate agent job cost 75 runner seconds, alongside unit jobs of 111–166 seconds. Release `44124203288` promoted images in 30 seconds and ran its smoke job in 119 seconds, without rebuilding.

For the mobile responsive statistics test, two local runs per version in reversed order used the same 1.7.2 digests, Docker stack, Chromium and two workers. Mean wall time fell from 53.5 to 18.7 seconds; summed test time fell from 96.64 to 27.76 seconds. Both versions performed 45 width assertions per device; cold navigations fell from 90 to 18 across the two devices. All eight test results passed without retries. This is a measured improvement to that test, not a controlled measurement of the whole CI pipeline. Each route still has a cold load at 320px, followed by the resize matrix.

Further tuning remains evidence-driven: parallel image builds/sharding and independent component releases. Sharing immutable images between PR shards has transfer/stack costs and must be compared after the navigation improvement. A static-check barrier would add the baseline's 60–78 seconds to every green run; heavy jobs therefore remain parallel while obsolete PR runs are cancelled. The five-minute server poll already exits quickly when unchanged; no shorter interval or extra polling infrastructure was introduced. The global Prisma CLI remains necessary for the current entrypoint; removing it requires a separate migrator contract. Those architecture changes are not prerequisites for the measured navigation fix.

The transient signup 500 still needs a reproducible cause. The 1.7.2 baseline had 219 passing tests, no flaky/retried tests and no structured HTTP-500 records in its retained service logs; that sample does not establish that the old intermittent failure is fixed. Retries were not increased. See [deployment and release process](DEPLOYMENT.md) for receipts, retention previews, migration rehearsals and the delivery command.
