import hashlib
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from release import build_manifest, create_source_archive, validate_release


class ReleaseTests(unittest.TestCase):
    def test_tag_must_match_version_and_stable_branch_ancestry(self):
        with patch("release.subprocess.run") as run:
            run.side_effect = [
                subprocess.CompletedProcess([], 0, stdout="tag\n"),
                subprocess.CompletedProcess([], 0, stdout="a" * 40 + "\n"),
                subprocess.CompletedProcess([], 0, stdout=""),
            ]
            validate_release("1.6.1", "tourmalet-v1.6.1", "a" * 40)
            self.assertEqual([call.args[0] for call in run.call_args_list], [
                ["git", "cat-file", "-t", "refs/tags/tourmalet-v1.6.1"],
                ["git", "rev-parse", "refs/tags/tourmalet-v1.6.1^{}"],
                ["git", "merge-base", "--is-ancestor", "a" * 40, "origin/tourmalet"],
            ])

        with self.assertRaisesRegex(ValueError, "match VERSION"):
            validate_release("1.6.1", "tourmalet-v1.6.2", "a" * 40, "origin/tourmalet")
        with self.assertRaisesRegex(ValueError, "match VERSION"):
            validate_release("1.6.1-rc.1", "tourmalet-v1.6.1-rc.1", "a" * 40, "origin/tourmalet")

    def test_release_commit_must_be_in_stable_branch(self):
        with patch("release.subprocess.run") as run:
            run.side_effect = [
                subprocess.CompletedProcess([], 0, stdout="tag\n"),
                subprocess.CompletedProcess([], 0, stdout="a" * 40 + "\n"),
                subprocess.CompletedProcess([], 1, stdout=""),
            ]
            with self.assertRaisesRegex(ValueError, "not reachable"):
                validate_release("1.6.1", "tourmalet-v1.6.1", "a" * 40, "origin/tourmalet")

    def test_rejects_lightweight_and_misdirected_tags(self):
        with patch("release.subprocess.run") as run:
            run.return_value = subprocess.CompletedProcess([], 0, stdout="commit\n")
            with self.assertRaisesRegex(ValueError, "annotated Git tag"):
                validate_release("1.6.1", "tourmalet-v1.6.1", "a" * 40)
        with patch("release.subprocess.run") as run:
            run.side_effect = [
                subprocess.CompletedProcess([], 0, stdout="tag\n"),
                subprocess.CompletedProcess([], 0, stdout="b" * 40 + "\n"),
            ]
            with self.assertRaisesRegex(ValueError, "point to the tested revision"):
                validate_release("1.6.1", "tourmalet-v1.6.1", "a" * 40)

    def test_manifest_matches_server_contract(self):
        result = build_manifest(
            "1.6.1",
            "tourmalet-v1.6.1",
            "a" * 40,
            "b" * 40,
            "c" * 64,
            "d" * 64,
            "e" * 64,
        )
        self.assertEqual(result, {
            "schemaVersion": 1,
            "version": "1.6.1",
            "tag": "tourmalet-v1.6.1",
            "revision": "a" * 40,
            "migrationTree": "b" * 40,
            "images": {
                "api": "ghcr.io/gustathecreator/openathlete-api@sha256:" + "c" * 64,
                "web": "ghcr.io/gustathecreator/openathlete-web@sha256:" + "d" * 64,
            },
            "source": {
                "url": "https://github.com/GustaTheCreator/openathlete/releases/download/tourmalet-v1.6.1/openathlete-tourmalet-v1.6.1.tar.gz",
                "sha256": "e" * 64,
            },
        })

    def test_source_archive_is_created_from_requested_commit(self):
        with tempfile.TemporaryDirectory() as temp_dir, patch("release.subprocess.run") as run:
            run.side_effect = lambda args, **kwargs: Path(
                args[args.index("--output") + 1]
            ).write_bytes(b"archive")
            archive, digest = create_source_archive("tourmalet-v1.6.1", "a" * 40, Path(temp_dir))
            self.assertEqual(archive.name, "openathlete-tourmalet-v1.6.1.tar.gz")
            self.assertEqual(digest, hashlib.sha256(b"archive").hexdigest())


if __name__ == "__main__":
    unittest.main()
