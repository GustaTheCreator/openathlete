"""Resume a reviewed Tourmalet change through exact CI, release and optional deploy."""

from __future__ import annotations

import argparse
import json
import re
import shlex
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from release import validate_candidate

REPOSITORY = "GustaTheCreator/openathlete"
STABLE_BRANCH = "tourmalet"
POLL_SECONDS = 10
COMMAND_TIMEOUT = 30
REMOTE_TIMEOUT = 900


class DeliveryError(RuntimeError):
    pass


class CommandRunner:
    def run(self, argv: list[str], *, timeout: int = COMMAND_TIMEOUT) -> str:
        try:
            result = subprocess.run(argv, check=False, capture_output=True, text=True, timeout=timeout)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise DeliveryError(f"Command failed or timed out: {argv[0]}") from exc
        if result.returncode:
            raise DeliveryError(f"Command failed ({result.returncode}): {argv[0]}")
        return result.stdout.strip()


def check_origin(url: str) -> None:
    normalized = url.removesuffix(".git").rstrip("/").lower()
    if normalized not in ("https://github.com/gustathecreator/openathlete",
                          "git@github.com:gustathecreator/openathlete"):
        raise DeliveryError("origin must be GustaTheCreator/openathlete on GitHub")


def require_pr(pr: dict, expected_head: str) -> None:
    if pr.get("baseRefName") != STABLE_BRANCH:
        raise DeliveryError("Pull request base must be tourmalet")
    if pr.get("headRefOid") != expected_head:
        raise DeliveryError("Pull request head changed since the delivery started")
    if pr.get("state") not in ("OPEN", "MERGED"):
        raise DeliveryError("Pull request is closed without a merge")


def pr_checks_ready(pr: dict) -> bool:
    for check in pr.get("statusCheckRollup", []):
        name = check.get("name") or check.get("context")
        if name != "CI passed":
            continue
        conclusion = (check.get("conclusion") or check.get("state") or "").upper()
        status = (check.get("status") or "COMPLETED").upper()
        if status not in ("COMPLETED", "SUCCESS", "SUCCESSFUL"):
            return False
        if conclusion in ("FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "ERROR"):
            raise DeliveryError("Pull request aggregate check did not pass")
        return conclusion in ("SUCCESS", "SUCCESSFUL")
    return False


def select_stable_run(runs: list[dict], revision: str) -> dict | None:
    matching = [run for run in runs if run.get("headSha") == revision
                and run.get("event") == "push" and run.get("headBranch") == STABLE_BRANCH]
    return matching[0] if matching else None


def validate_manifest(manifest: dict, *, version: str, tag: str, revision: str,
                      api_digest: str, web_digest: str) -> None:
    if (manifest.get("version") != version or manifest.get("tag") != tag
            or manifest.get("revision") != revision):
        raise DeliveryError("Published manifest does not match the tested release identity")
    images = manifest.get("images", {})
    if not images.get("api", "").endswith("@" + api_digest):
        raise DeliveryError("Published API digest does not match the tested candidate")
    if not images.get("web", "").endswith("@" + web_digest):
        raise DeliveryError("Published web digest does not match the tested candidate")
    source = manifest.get("source", {})
    if not re.fullmatch(r"[0-9a-f]{64}", source.get("sha256", "")):
        raise DeliveryError("Published source archive checksum is invalid")
    expected_source = f"https://github.com/{REPOSITORY}/releases/download/{tag}/openathlete-{tag}.tar.gz"
    if (source.get("url") != expected_source
            or not re.fullmatch(r"[0-9a-f]{40}", manifest.get("migrationTree", ""))):
        raise DeliveryError("Published source or migration-tree identity is invalid")


def parse_server_status(output: str) -> dict:
    version = re.search(r"^Version: (\S+)$", output, re.MULTILINE)
    revision = re.search(r"^Revision: ([0-9a-f]{40})$", output, re.MULTILINE)
    images = re.search(r"^Images: (\{.*\})$", output, re.MULTILINE)
    if not version or not revision or not images or "Runtime: healthy; image digests verified" not in output.splitlines():
        raise DeliveryError("Deployment status did not verify the release receipt and live services; update the server updater first")
    try:
        parsed_images = json.loads(images.group(1))
    except json.JSONDecodeError as exc:
        raise DeliveryError("Deployment status contained invalid image metadata") from exc
    return {"version": version.group(1), "revision": revision.group(1), "images": parsed_images}


class Delivery:
    def __init__(self, args, runner=None, *, sleep=time.sleep, clock=time.monotonic):
        self.args = args
        self.runner = runner or CommandRunner()
        self.sleep = sleep
        self.clock = clock
        self.deadline = clock() + args.timeout_seconds
        self.receipt = {"repository": REPOSITORY, "pullRequest": args.pr,
                        "mode": "apply" if args.apply else "plan", "steps": []}

    def call(self, label: str, argv: list[str], *, timeout=COMMAND_TIMEOUT) -> str:
        if self.args.apply and self.clock() >= self.deadline:
            raise DeliveryError(f"Timed out before {label}")
        try:
            return self.runner.run(argv, timeout=min(timeout, max(1, int(self.deadline - self.clock())))
                                   if self.args.apply else timeout)
        except DeliveryError:
            self.receipt["steps"].append({"name": label, "status": "failed"})
            self.write_receipt()
            raise

    def record(self, name, status, **details):
        self.receipt["steps"].append({"name": name, "status": status, **details})
        self.write_receipt()

    def write_receipt(self):
        if self.args.receipt:
            self.args.receipt.write_text(json.dumps(self.receipt, indent=2) + "\n", encoding="utf-8")

    def wait(self, label, query):
        while True:
            if self.clock() >= self.deadline:
                raise DeliveryError(f"Timed out waiting for {label}")
            value = query()
            if value:
                return value
            self.sleep(min(POLL_SECONDS, max(0, self.deadline - self.clock())))

    def run(self):
        branch = self.call("current branch", ["git", "branch", "--show-current"])
        head = self.call("current revision", ["git", "rev-parse", "HEAD"])
        origin = self.call("repository identity", ["git", "remote", "get-url", "origin"])
        check_origin(origin)
        if self.call("working tree", ["git", "status", "--porcelain"]):
            raise DeliveryError("Working tree must be clean before delivery")
        pr = json.loads(self.call("pull request", ["gh", "pr", "view", str(self.args.pr),
            "--json", "state,baseRefName,headRefOid,mergeCommit,statusCheckRollup"]))
        require_pr(pr, head)
        self.receipt.update({"branch": branch, "pullRequestHead": head})

        if not self.args.apply:
            self.receipt["plannedActions"] = ["wait for all PR checks including CI passed", "squash merge PR",
                "wait for successful stable push CI on the merge SHA", "validate tested image candidate",
                "create immutable annotated Tourmalet tag", "wait for release smoke and publication"]
            if self.args.ssh_target:
                self.receipt["plannedActions"].append("check and deploy through the supplied server wrapper")
            self.record("preflight", "ready", branch=branch)
            return self.receipt

        if pr["state"] == "OPEN":
            self.wait("PR checks", lambda: self._wait_pr_checks())
            pr = self._pr()
            if pr["state"] == "OPEN":
                self.call("merge pinned pull request", ["gh", "pr", "merge", str(self.args.pr), "--squash",
                    "--match-head-commit", head], timeout=60)
                pr = self._pr("merged pull request")
        require_pr(pr, head)
        merge = (pr.get("mergeCommit") or {}).get("oid")
        if pr["state"] != "MERGED" or not re.fullmatch(r"[0-9a-f]{40}", merge or ""):
            raise DeliveryError("Pull request did not produce a verified merge commit")
        self.receipt["revision"] = merge
        self.record("pull request", "merged", revision=merge)

        self.call("fetch stable branch", ["git", "fetch", "origin", STABLE_BRANCH])
        if self.call("stable ancestry", ["git", "merge-base", "--is-ancestor", merge, "FETCH_HEAD"]):
            raise DeliveryError("PR merge commit is not reachable from the stable branch")
        version = self.call("release version", ["git", "show", f"{merge}:VERSION"])
        if not re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", version):
            raise DeliveryError("Stable commit VERSION is not a release SemVer")
        self.receipt["version"] = version
        stable_run = self.wait("successful stable push CI", lambda: self._stable_run(merge))
        self.receipt["stableCi"] = {"runId": stable_run["databaseId"], "url": stable_run.get("url")}
        candidate = self._candidate(stable_run, merge, version)
        self.receipt["images"] = {key: candidate[key] for key in ("api", "web")}
        self.record("stable CI candidate", "validated", runId=stable_run["databaseId"])

        tag = f"tourmalet-v{version}"
        self._ensure_tag(tag, merge)
        self.receipt["tag"] = tag
        release_run = self.wait("published release workflow", lambda: self._release_run(tag, merge))
        self.receipt["release"] = {"runId": release_run["id"], "url": release_run.get("html_url")}
        manifest = self._manifest(tag, version, merge, candidate)
        self.receipt["manifestValidated"] = True
        self.record("release", "published", runId=release_run["id"], url=release_run.get("html_url"))

        if self.args.ssh_target:
            self._deploy(tag, version, merge, candidate)
        else:
            self.record("deployment", "not requested")
        self.record("delivery", "complete")
        return self.receipt

    def _wait_pr_checks(self):
        pr = self._pr("pull request checks")
        require_pr(pr, self.receipt["pullRequestHead"])
        return pr if pr_checks_ready(pr) else None

    def _pr(self, label="pull request"):
        return json.loads(self.call(label, ["gh", "pr", "view", str(self.args.pr),
            "--json", "state,baseRefName,headRefOid,mergeCommit,statusCheckRollup"]))

    def _stable_run(self, revision):
        runs = json.loads(self.call("stable push CI", ["gh", "run", "list", "--workflow", "ci.yml",
            "--branch", STABLE_BRANCH, "--event", "push", "--commit", revision,
            "--limit", "100", "--json", "databaseId,headSha,event,headBranch,status,conclusion,url"]))
        run = select_stable_run(runs, revision)
        if not run or run.get("status") not in ("completed", "completed_successfully"):
            return None
        if run.get("conclusion") != "success":
            raise DeliveryError("Stable push CI failed for the merge commit")
        jobs = json.loads(self.call("stable CI jobs", ["gh", "run", "view", str(run["databaseId"]), "--json", "jobs"]))
        if not any(job.get("name") == "CI passed" and job.get("conclusion") == "success"
                   for job in jobs.get("jobs", [])):
            raise DeliveryError("Stable push CI did not pass its required aggregate gate")
        return run

    def _candidate(self, run, revision, version):
        with tempfile.TemporaryDirectory(prefix="openathlete-candidate-") as directory:
            self.call("download stable candidate", ["gh", "run", "download", str(run["databaseId"]),
                "--name", "tourmalet-candidate", "--dir", directory])
            path = Path(directory) / "candidate.json"
            if not path.is_file():
                raise DeliveryError("Stable CI candidate artifact is missing")
            return validate_candidate(json.loads(path.read_text(encoding="utf-8")), version, revision)

    def _ensure_tag(self, tag, revision):
        refs = self.call("remote release tag", ["git", "ls-remote", "origin", f"refs/tags/{tag}", f"refs/tags/{tag}^{{}}"])
        if refs:
            rows = [line.split("\t", 1) for line in refs.splitlines() if "\t" in line]
            peeled = next((sha for sha, ref in rows if ref == f"refs/tags/{tag}^{{}}"), None)
            if not peeled or peeled != revision:
                raise DeliveryError("Release tag already exists but is not the expected annotated tag")
            remote_ref = f"refs/codex-deliver/{tag}"
            self.call("fetch existing release tag", ["git", "fetch", "origin", f"refs/tags/{tag}:{remote_ref}"])
            if self.call("existing tag type", ["git", "cat-file", "-t", remote_ref]) != "tag":
                raise DeliveryError("Existing release tag is not annotated")
            if self.call("existing tag revision", ["git", "rev-parse", f"{remote_ref}^{{}}"] ) != revision:
                raise DeliveryError("Existing release tag points to another commit")
            self.record("release tag", "already present", tag=tag)
            return
        local_ref = f"refs/tags/{tag}"
        if self.call("local release tag", ["git", "tag", "--list", tag], timeout=10):
            local_type = self.call("local release tag type", ["git", "cat-file", "-t", local_ref], timeout=10)
            if local_type != "tag" or self.call("local tag revision", ["git", "rev-parse",
                    f"{local_ref}^{{}}"], timeout=10) != revision:
                raise DeliveryError("Local release tag exists with a different identity")
            self.call("push release tag", ["git", "push", "origin", local_ref])
            self.record("release tag", "pushed existing annotated tag", tag=tag)
            return
        self.call("create annotated release tag", ["git", "tag", "-a", tag, revision, "-m", f"Tourmalet {tag.removeprefix('tourmalet-v')}"])
        self.call("push release tag", ["git", "push", "origin", f"refs/tags/{tag}"])
        self.record("release tag", "pushed", tag=tag)

    def _release_run(self, tag, revision):
        response = json.loads(self.call("release workflow", ["gh", "api",
            f"repos/{REPOSITORY}/actions/workflows/tourmalet-release.yml/runs",
            "--method", "GET", "-f", "event=push", "-f", f"head_sha={revision}", "-f", "per_page=100"]))
        runs = [run for run in response.get("workflow_runs", [])
                if run.get("head_sha") == revision and run.get("head_branch") == tag and run.get("event") == "push"]
        if not runs:
            return None
        run = runs[0]
        if run.get("status") != "completed":
            return None
        if run.get("conclusion") != "success":
            raise DeliveryError("Tourmalet release workflow failed")
        return run

    def _manifest(self, tag, version, revision, candidate):
        view = json.loads(self.call("published GitHub release", ["gh", "release", "view", tag,
            "--json", "tagName,isDraft,url"]))
        if view.get("tagName") != tag or view.get("isDraft"):
            raise DeliveryError("GitHub release is missing or remains a draft")
        with tempfile.TemporaryDirectory(prefix="openathlete-manifest-") as directory:
            self.call("download release manifest", ["gh", "release", "download", tag,
                "--pattern", "tourmalet-release.json", "--dir", directory])
            path = Path(directory) / "tourmalet-release.json"
            if not path.is_file():
                raise DeliveryError("Published release manifest is missing")
            manifest = json.loads(path.read_text(encoding="utf-8"))
        validate_manifest(manifest, version=version, tag=tag, revision=revision,
                          api_digest=candidate["api"], web_digest=candidate["web"])
        self.receipt["release"]["url"] = view.get("url")
        return manifest

    def _remote(self, subcommand):
        parts = shlex.split(self.args.deploy_command, posix=True)
        command = shlex.join([*parts, subcommand])
        return self.call(f"server {subcommand}", ["ssh", self.args.ssh_target, command], timeout=REMOTE_TIMEOUT)

    def _deploy(self, tag, version, revision, candidate):
        status_output = self._remote("status")
        status = parse_server_status(status_output)
        expected = {key: "ghcr.io/gustathecreator/openathlete-" + key + "@" + candidate[key]
                    for key in ("api", "web")}
        if status["version"] != version or status["revision"] != revision or status["images"] != expected:
            self._remote("check")
            self._remote("deploy")
            status = parse_server_status(self._remote("status"))
        if status["version"] != version or status["revision"] != revision or status["images"] != expected:
            raise DeliveryError("Server receipt does not match the released commit and tested images")
        self.receipt["deployment"] = {"status": "verified", "version": version, "revision": revision,
                                       "images": candidate}
        self.record("deployment", "verified", version=version, revision=revision)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pr", required=True, type=int, help="reviewed pull request number")
    parser.add_argument("--apply", action="store_true", help="wait, merge, tag and publish the reviewed delivery")
    parser.add_argument("--ssh-target", help="configured SSH alias for the existing Tourmalet updater")
    parser.add_argument("--deploy-command", help="server updater executable and fixed arguments")
    parser.add_argument("--receipt", type=Path, help="write a non-secret JSON delivery receipt")
    parser.add_argument("--timeout-seconds", type=int, default=2700, help="overall wait limit (default: 2700)")
    args = parser.parse_args(argv)
    if args.pr < 1 or args.timeout_seconds < 1:
        parser.error("PR and timeout must be positive")
    if bool(args.ssh_target) != bool(args.deploy_command):
        parser.error("--ssh-target and --deploy-command must be supplied together")
    return args


def main(argv=None):
    args = parse_args(argv)
    delivery = Delivery(args)
    try:
        receipt = delivery.run()
        print(json.dumps(receipt, indent=2))
        return 0
    except (DeliveryError, ValueError, json.JSONDecodeError) as exc:
        delivery.record("delivery", "failed")
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
