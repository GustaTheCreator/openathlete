import json
import unittest
from unittest.mock import patch

import rehearse
from deployer import DeployError


class ImageIdentityTests(unittest.TestCase):
    def test_only_a_changed_migration_tree_requires_release_rehearsal(self):
        image = "ghcr.io/gustathecreator/openathlete-api@sha256:" + "a" * 64
        with patch.object(rehearse, "_run", return_value=b"b" * 40), \
                patch.object(rehearse, "_github_release", return_value=("tourmalet-v1.7.2", {"manifest": "url", "source": "source"})), \
                patch.object(rehearse, "_request", return_value=b"{}"), \
                patch.object(rehearse, "validate_manifest", return_value={"migrationTree": "b" * 40, "images": {"api": image}}) as validate:
            self.assertEqual(rehearse.baseline_for("c" * 40), {"rehearsal-needed": "false", "base-api-image": image})
            validate.return_value["migrationTree"] = "d" * 40
            self.assertEqual(rehearse.baseline_for("c" * 40)["rehearsal-needed"], "true")
        with self.assertRaises(DeployError):
            rehearse.baseline_for("tourmalet")

    def test_rejects_mutable_or_foreign_image_names(self):
        for image in ("openathlete-api:latest", "ghcr.io/other/api@sha256:" + "a" * 64,
                      "ghcr.io/gustathecreator/openathlete-api@sha256:" + "a" * 63):
            with self.subTest(image=image), self.assertRaisesRegex(DeployError, "immutable"):
                rehearse._image_identity(image)

    def test_image_revision_and_migration_tree_are_bound_to_image_labels(self):
        image = "ghcr.io/gustathecreator/openathlete-api@sha256:" + "a" * 64
        labels = {"org.opencontainers.image.source": rehearse.REPOSITORY_URL,
                  "org.opencontainers.image.revision": "b" * 40,
                  "org.opencontainers.image.version": "1.7.3"}
        with patch.object(rehearse, "_run", side_effect=[json.dumps(labels).encode(), b"c" * 40]) as run:
            identity = rehearse._image_identity(image)
        self.assertEqual(identity["image"], image)
        self.assertEqual(identity["revision"], "b" * 40)
        self.assertEqual(identity["migrationTree"], "c" * 40)
        self.assertEqual(run.call_args_list[1].args[0][-1], "b" * 40 + ":libs/database/prisma/schema/migrations")

    def test_rejects_foreign_source_label(self):
        image = "ghcr.io/gustathecreator/openathlete-api@sha256:" + "a" * 64
        with patch.object(rehearse, "_run", return_value=json.dumps({
                "org.opencontainers.image.source": "https://example.com",
                "org.opencontainers.image.revision": "b" * 40}).encode()):
            with self.assertRaisesRegex(DeployError, "source or revision"):
                rehearse._image_identity(image)


class RehearsalTests(unittest.TestCase):
    def test_same_base_and_candidate_is_allowed_for_restore_only_positive_control(self):
        image = "ghcr.io/gustathecreator/openathlete-api@sha256:" + "a" * 64
        identity = {"image": image, "revision": "b" * 40, "version": "1.7.3", "migrationTree": "c" * 40}
        with patch.object(rehearse, "_image_identity", return_value=identity), \
                patch.object(rehearse, "_run", return_value=b"ok"), \
                patch.object(rehearse, "_start_database"), \
                patch.object(rehearse, "_migrate"), \
                patch.object(rehearse, "_sql", return_value=rehearse.FIXTURE), \
                patch.object(rehearse, "_migration_count", side_effect=[11, 11, 11]):
            receipt = rehearse.rehearse(image, image)
        self.assertTrue(receipt["positiveControlOnly"])
        self.assertFalse(receipt["migrationTreeChanged"])
        self.assertEqual(receipt["result"], "passed")

    def test_json_receipt_contains_no_private_runtime_details(self):
        image = "ghcr.io/gustathecreator/openathlete-api@sha256:" + "a" * 64
        other_image = "ghcr.io/gustathecreator/openathlete-api@sha256:" + "b" * 64
        identity = {"image": image, "revision": "b" * 40, "version": "1.7.3", "migrationTree": "c" * 40}
        next_identity = {**identity, "image": other_image, "revision": "d" * 40, "version": "1.7.4"}
        with patch.object(rehearse, "_image_identity", side_effect=[identity, next_identity]), \
                patch.object(rehearse, "_run", return_value=b"ok"), \
                patch.object(rehearse, "_start_database"), \
                patch.object(rehearse, "_migrate"), \
                patch.object(rehearse, "_sql", return_value=rehearse.FIXTURE), \
                patch.object(rehearse, "_migration_count", side_effect=[11, 11, 11]), \
                patch.object(rehearse.time, "monotonic", return_value=0):
            receipt = rehearse.rehearse(image, other_image)
        serialized = rehearse.json.dumps(receipt)
        for forbidden in (".env", "DATABASE_URL", "postgresql://", "127.0.0.1"):
            self.assertNotIn(forbidden, serialized)

    def test_success_runs_upgrade_and_restore_then_removes_only_owned_resources(self):
        base_image = "ghcr.io/gustathecreator/openathlete-api@sha256:" + "a" * 64
        candidate_image = "ghcr.io/gustathecreator/openathlete-api@sha256:" + "b" * 64
        base = {"image": base_image, "revision": "c" * 40, "version": "1.7.2", "migrationTree": "d" * 40}
        candidate = {"image": candidate_image, "revision": "e" * 40, "version": "1.7.3", "migrationTree": "f" * 40}
        commands = []

        def fake_run(args, **kwargs):
            commands.append(list(args))
            if args[:3] == ["docker", "exec", "base"] and "pg_dump" in args:
                return b"synthetic backup"
            if args[:3] == ["docker", "inspect", "--format"]:
                return b"healthy"
            return b"ok"

        def run_with_names(args, **kwargs):
            if args[:2] == ["docker", "run"] and "--detach" in args:
                name = args[args.index("--name") + 1]
                marker = "base" if "-base-" in name else "restore"
                args = ["docker", "run", "--detach", "--name", marker, *args[5:]]
            return fake_run(args, **kwargs)

        with patch.object(rehearse, "_image_identity", side_effect=[base, candidate]), \
                patch.object(rehearse, "_run", side_effect=run_with_names), \
                patch.object(rehearse, "_sql", return_value=rehearse.FIXTURE), \
                patch.object(rehearse, "_migration_count", side_effect=[11, 10, 11]), \
                patch.object(rehearse.time, "monotonic", return_value=0), \
                patch.object(rehearse.time, "sleep"):
            receipt = rehearse.rehearse(base_image, candidate_image)
        self.assertEqual(receipt["result"], "passed")
        self.assertTrue(receipt["steps"]["restorePreservedFixture"])
        self.assertTrue(receipt["steps"]["restoredUpgradeVerified"])
        self.assertEqual(receipt["candidateMigrationCount"], 11)
        removals = [cmd for cmd in commands if cmd[:2] == ["docker", "rm"]]
        self.assertEqual(len(removals), 2)
        self.assertTrue(all("oa-migration-rehearsal-" in cmd[-1] for cmd in removals))
        networks = [cmd for cmd in commands if cmd[:3] == ["docker", "network", "rm"]]
        self.assertEqual(len(networks), 1)

    def test_candidate_failure_still_cleans_created_database_and_network(self):
        base_image = "ghcr.io/gustathecreator/openathlete-api@sha256:" + "a" * 64
        candidate_image = "ghcr.io/gustathecreator/openathlete-api@sha256:" + "b" * 64
        identity = {"image": base_image, "revision": "c" * 40, "version": "1.7.2", "migrationTree": "d" * 40}
        next_identity = {**identity, "image": candidate_image, "revision": "e" * 40, "version": "1.7.3"}
        commands = []

        def fake_run(args, **kwargs):
            commands.append(list(args))
            if args[:2] == ["docker", "run"] and "--entrypoint" in args and candidate_image in args:
                raise DeployError("simulated candidate migration failure")
            if args[:3] == ["docker", "inspect", "--format"]:
                return b"healthy"
            if "pg_dump" in args:
                return b"synthetic backup"
            return b"ok"

        with patch.object(rehearse, "_image_identity", side_effect=[identity, next_identity]), \
                patch.object(rehearse, "_run", side_effect=fake_run), \
                patch.object(rehearse, "_sql", return_value=""), \
                patch.object(rehearse.time, "monotonic", return_value=0), \
                patch.object(rehearse.time, "sleep"):
            with self.assertRaisesRegex(DeployError, "simulated candidate migration"):
                rehearse.rehearse(base_image, candidate_image)
        self.assertTrue(any(cmd[:2] == ["docker", "rm"] for cmd in commands))
        self.assertTrue(any(cmd[:3] == ["docker", "network", "rm"] for cmd in commands))


if __name__ == "__main__":
    unittest.main()
