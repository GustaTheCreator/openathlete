---
name: review-pr
description: Review an external OpenAthlete pull request for correctness, security, self-hosting and project conventions, and prepare a clear review recommendation. Use when asked to inspect a contributor PR.
---

# Review a contributor PR

Reviews should be precise, kind and concrete. Contributors usually write in English, so draft review text in English. The canonical project guide is [AGENTS.md](../../../AGENTS.md); area rules are in `apps/api/AGENTS.md` and `apps/web/AGENTS.md`.

## Understand and assess

Read the full PR description and diff. Check scope and dependencies, authorization through CASL, rate limiting for public writes, environment-gating for third-party calls, self-hosting behavior, migration safety and account deletion coverage, translations, tests, and nginx header conventions.

The stable branch is `tourmalet`; `main` is a divergent upstream branch. Do not assume an external PR targets either branch: inspect its base and report it. Use available read-only PR context, fetch PR refs and validate locally when useful; preserve the dirty worktree, prefer the current checkout when suitable or an isolated worktree when needed. Remote writes, approving CI, posting review actions and deleting remote branches need explicit task authorization. A local merge is acceptable only in an isolated checkout and must not replace or damage existing work.

Use project verification commands appropriate to the changed paths and provide concrete evidence. For UI changes, include desktop and mobile coverage where feasible. Report limitations rather than implying checks passed.

## Recommendation

Return numbered findings with file, issue, impact and suggested correction. If no blockers are found, state that and include any non-blocking follow-ups. Escalate larger feature or product decisions to the maintainer.

Approval, request-changes reviews, merges, conflict pushes, CI approval, public comments and branch deletion are external side effects. The request to inspect a PR does not authorize them; require explicit authorization for the particular action before performing it.

## Handoff:

Return findings, verification evidence and draft review wording to the maintainer. Do not perform external review or repository mutations without explicit authorization.
