"""Conservative CI selection; unknown inputs always run every check."""

import json
import os
import subprocess
from pathlib import Path

CHECKS = ("app", "website", "docs", "deploy")


def classify(paths):
    selected = set()
    for path in paths:
        if path.startswith("apps/docs/"):
            selected.add("docs")
        elif path.startswith("apps/website/"):
            selected.add("website")
        elif path.startswith(("apps/api/", "apps/web/", "e2e/")):
            selected.add("app")
        elif path.startswith(("deploy/", "scripts/")):
            return dict.fromkeys(CHECKS, True)
        elif path == "VERSION":
            selected.update(("app", "deploy"))
        elif path.startswith(("doc/", ".github/docs/", ".agents/")) or path in (
            "README.md", "AGENTS.md", "CONTEXT.md", "PRD.md", "ARCHITECTURE.md",
            "DESIGN_SYSTEM.md", "LICENSE", ".github/SECURITY.md",
            ".github/CONTRIBUTING.md", ".github/CODE_OF_CONDUCT.md",
            "docs/decisions.md",
        ):
            continue
        else:
            return dict.fromkeys(CHECKS, True)
    return {check: check in selected for check in CHECKS}


def required_checks_pass(results):
    if results.get("changes", {}).get("result") != "success":
        return False
    outputs = results["changes"].get("outputs", {})
    if outputs.get("candidate") not in ("true", "false"):
        return False
    groups = {
        "app": ("lint", "type-check", "test", "integration", "agents"),
        "website": ("website",), "docs": ("docs",), "deploy": ("deploy-tests",),
    }
    for group, jobs in groups.items():
        if outputs.get(group) not in ("true", "false"):
            return False
        for job in jobs:
            result = results.get(job, {}).get("result")
            if result != "success" and not (outputs[group] == "false" and result == "skipped"):
                return False
    for job in ("e2e", "candidate"):
        required = outputs.get("app") == "true" and (
            (job == "candidate") == (outputs["candidate"] == "true")
        )
        if results.get(job, {}).get("result") != ("success" if required else "skipped"):
            return False
    return True


def main():
    if "RESULTS" in os.environ:
        if not required_checks_pass(json.loads(os.environ["RESULTS"])):
            raise SystemExit("A required CI check failed, was cancelled, or was skipped")
        return
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    base = event.get("pull_request", {}).get("base", {}).get("sha") or event.get("before")
    head = event.get("pull_request", {}).get("head", {}).get("sha") or os.environ["GITHUB_SHA"]
    paths = None
    if base and base != "0" * 40:
        # PRs compare to their merge base; pushes include all commits in the push.
        diff = f"{base}...{head}" if "pull_request" in event else f"{base}..{head}"
        result = subprocess.run(["git", "diff", "--name-only", "--no-renames", "-z", diff], capture_output=True)
        if result.returncode == 0:
            paths = result.stdout.decode().strip("\0").split("\0") if result.stdout else []
    scope = classify(paths) if paths is not None else dict.fromkeys(CHECKS, True)
    scope["candidate"] = (
        scope["app"] and os.environ.get("GITHUB_EVENT_NAME") == "push"
        and os.environ.get("GITHUB_REF") == "refs/heads/tourmalet"
        and os.environ.get("GITHUB_REPOSITORY") == "GustaTheCreator/openathlete"
    )
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        for key, value in scope.items():
            print(f"{key}={str(value).lower()}", file=output)
    print(json.dumps(scope))


if __name__ == "__main__":
    main()
