import json
import tempfile
import unittest
from pathlib import Path

from deliver import (
    Delivery,
    DeliveryError,
    parse_args,
    parse_server_status,
    pr_checks_ready,
    require_pr,
    select_stable_run,
    validate_manifest,
)


class FakeRunner:
    def __init__(self, responses=None):
        self.responses = responses or {}
        self.calls = []

    def run(self, argv, *, timeout=30):
        self.calls.append(argv)
        key = tuple(argv)
        value = self.responses.get(key, "")
        if isinstance(value, Exception):
            raise value
        return value


def args(**changes):
    values = dict(pr=8, apply=False, ssh_target=None, deploy_command=None,
                  receipt=None, timeout_seconds=100)
    values.update(changes)
    return type("Args", (), values)()


class DeliveryTests(unittest.TestCase):
    def test_receipt_without_live_health_verification_is_rejected(self):
        with self.assertRaisesRegex(DeliveryError, "live services"):
            parse_server_status(f"Version: 1.7.3\nRevision: {'a' * 40}\nImages: {{}}")

    def test_release_workflow_lookup_is_a_get_request(self):
        runner = FakeRunner()
        delivery = Delivery(args(), runner)
        response_key = ("gh", "api", "repos/GustaTheCreator/openathlete/actions/workflows/tourmalet-release.yml/runs",
                        "--method", "GET", "-f", "event=push", "-f", "head_sha=" + "a" * 40, "-f", "per_page=100")
        runner.responses[response_key] = '{"workflow_runs": []}'
        self.assertIsNone(delivery._release_run("tourmalet-v1.7.3", "a" * 40))
        self.assertIn(list(response_key), runner.calls)

    def test_origin_pull_request_head_and_base_are_pinned(self):
        from deliver import check_origin
        check_origin("https://github.com/GustaTheCreator/openathlete.git")
        check_origin("git@github.com:GustaTheCreator/openathlete.git")
        with self.assertRaises(DeliveryError):
            check_origin("https://github.com/someone-else/openathlete.git")
        pr = {"baseRefName": "tourmalet", "headRefOid": "a" * 40, "state": "OPEN"}
        require_pr(pr, "a" * 40)
        for changed in ({**pr, "baseRefName": "main"}, {**pr, "headRefOid": "b" * 40}):
            with self.subTest(changed=changed), self.assertRaises(DeliveryError):
                require_pr(changed, "a" * 40)

    def test_waits_for_aggregate_check_and_blocks_check_failures(self):
        self.assertTrue(pr_checks_ready({"statusCheckRollup": [
            {"name": "lint", "status": "COMPLETED", "conclusion": "SUCCESS"},
            {"name": "CI passed", "status": "COMPLETED", "conclusion": "SUCCESS"},
        ]}))
        self.assertFalse(pr_checks_ready({"statusCheckRollup": [
            {"name": "CI passed", "status": "IN_PROGRESS"},
        ]}))
        with self.assertRaises(DeliveryError):
            pr_checks_ready({"statusCheckRollup": [
                {"name": "CI passed", "status": "COMPLETED", "conclusion": "FAILURE"},
            ]})

    def test_only_exact_successful_stable_push_run_is_selected(self):
        runs = [
            {"databaseId": 1, "headSha": "a" * 40, "event": "pull_request", "headBranch": "tourmalet"},
            {"databaseId": 2, "headSha": "a" * 40, "event": "push", "headBranch": "main"},
            {"databaseId": 3, "headSha": "b" * 40, "event": "push", "headBranch": "tourmalet"},
            {"databaseId": 4, "headSha": "a" * 40, "event": "push", "headBranch": "tourmalet"},
        ]
        self.assertEqual(select_stable_run(runs, "a" * 40)["databaseId"], 4)
        self.assertIsNone(select_stable_run(runs[:3], "a" * 40))

    def test_manifest_must_match_version_tag_revision_and_both_digests(self):
        candidate = {"api": "sha256:" + "b" * 64, "web": "sha256:" + "c" * 64}
        manifest = {"version": "1.7.3", "tag": "tourmalet-v1.7.3", "revision": "a" * 40,
                    "migrationTree": "e" * 40,
                    "images": {key: f"ghcr.io/gustathecreator/openathlete-{key}@{value}"
                               for key, value in candidate.items()},
                    "source": {"sha256": "d" * 64,
                               "url": "https://github.com/GustaTheCreator/openathlete/releases/download/"
                                     "tourmalet-v1.7.3/openathlete-tourmalet-v1.7.3.tar.gz"}}
        validate_manifest(manifest, version="1.7.3", tag="tourmalet-v1.7.3",
                          revision="a" * 40, api_digest=candidate["api"], web_digest=candidate["web"])
        for changed in ({**manifest, "revision": "e" * 40},
                        {**manifest, "images": {**manifest["images"], "web": "latest"}}):
            with self.subTest(changed=changed), self.assertRaises(DeliveryError):
                validate_manifest(changed, version="1.7.3", tag="tourmalet-v1.7.3",
                                  revision="a" * 40, api_digest=candidate["api"], web_digest=candidate["web"])

    def test_server_receipt_is_validated_and_bad_status_fails_closed(self):
        image = "ghcr.io/gustathecreator/openathlete-api@sha256:" + "b" * 64
        status = parse_server_status(f"Version: 1.7.3\nRevision: {'a' * 40}\nImages: {{\"api\": \"{image}\"}}\nRuntime: healthy; image digests verified")
        self.assertEqual(status["images"]["api"], image)
        with self.assertRaises(DeliveryError):
            parse_server_status("Version: latest\n")

    def test_dry_run_is_read_only_and_records_a_plan(self):
        head = "a" * 40
        runner = FakeRunner({
            ("git", "branch", "--show-current"): "codex/test",
            ("git", "rev-parse", "HEAD"): head,
            ("git", "remote", "get-url", "origin"): "https://github.com/GustaTheCreator/openathlete.git",
            ("git", "status", "--porcelain"): "",
            ("gh", "pr", "view", "8", "--json", "state,baseRefName,headRefOid,mergeCommit,statusCheckRollup"):
                json.dumps({"state": "OPEN", "baseRefName": "tourmalet", "headRefOid": head,
                            "mergeCommit": None, "statusCheckRollup": []}),
        })
        with tempfile.TemporaryDirectory() as directory:
            receipt = Path(directory) / "receipt.json"
            delivery = Delivery(args(receipt=receipt), runner)
            result = delivery.run()
            self.assertEqual(result["mode"], "plan")
            self.assertTrue(receipt.exists())
            self.assertFalse(any(call[:3] == ["gh", "pr", "merge"]
                                 or call[:2] == ["git", "tag"]
                                 or call[:2] == ["git", "push"]
                                 or call[0] == "ssh" for call in runner.calls))

    def test_failed_stable_ci_cannot_create_a_tag(self):
        runner = FakeRunner({
            ("gh", "run", "list", "--workflow", "ci.yml", "--branch", "tourmalet", "--event", "push",
             "--commit", "a" * 40, "--limit", "100", "--json",
             "databaseId,headSha,event,headBranch,status,conclusion,url"):
                json.dumps([{"databaseId": 9, "headSha": "a" * 40, "event": "push",
                             "headBranch": "tourmalet", "status": "completed", "conclusion": "failure"}]),
        })
        delivery = Delivery(args(apply=True), runner)
        with self.assertRaisesRegex(DeliveryError, "CI failed"):
            delivery._stable_run("a" * 40)
        self.assertFalse(any(call[:2] == ["git", "tag"] or call[:2] == ["git", "push"]
                             for call in runner.calls))

    def test_candidate_rejects_a_wrong_version_or_revision(self):
        from release import validate_candidate
        candidate = {"version": "1.7.2", "revision": "a" * 40,
                     "api": "sha256:" + "b" * 64, "web": "sha256:" + "c" * 64}
        for version, revision in [("1.7.3", "a" * 40), ("1.7.2", "d" * 40)]:
            with self.subTest(version=version, revision=revision), self.assertRaises(ValueError):
                validate_candidate(candidate, version, revision)

    def test_cli_requires_pr_and_paired_server_arguments(self):
        with self.assertRaises(SystemExit):
            parse_args([])
        with self.assertRaises(SystemExit):
            parse_args(["--pr", "8", "--ssh-target", "tourmalet"])
        self.assertFalse(parse_args(["--pr", "8"]).apply)


if __name__ == "__main__":
    unittest.main()
