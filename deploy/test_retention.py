import hashlib
import io
import json
import tempfile
import tarfile
import unittest
from pathlib import Path

import retention
import restore_check
from deployer import DeployError


class RetentionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.state = self.root / ".deploy"
        (self.state / "backups").mkdir(parents=True)
        (self.root / "public-source").mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def backup(self, stamp, content=None):
        path = self.state / "backups" / f"database-{stamp}.dump"
        path.write_bytes(content or f"backup-{stamp}".encode())
        return path

    def test_plan_preserves_latest_current_previous_and_operator_pins(self):
        paths = [self.backup(stamp) for stamp in range(1, 9)]
        current, previous = {"backup": str(paths[-1])}, {"current": {"backup": str(paths[-2])}}
        source = self.root / "public-source"
        (source / "openathlete.tar.gz").write_bytes(b"stable")
        old_source = source / "openathlete-tourmalet-v1.0.0.tar.gz"
        old_source.write_bytes(b"old source")
        plan = retention.plan_retention(self.root, self.state, current, previous,
                                        pins=["database-1.dump", "openathlete-tourmalet-v1.0.0.tar.gz"], keep=2)
        deleted = {item["name"] for item in plan["files"]}
        self.assertNotIn(paths[-1].name, deleted)
        self.assertNotIn(paths[-2].name, deleted)
        self.assertIn(paths[-3].name, deleted)
        self.assertNotIn(paths[0].name, deleted)
        self.assertNotIn(old_source.name, deleted)
        self.assertEqual(plan["backupSha256"], hashlib.sha256(paths[-1].read_bytes()).hexdigest())

    def test_plan_ignores_unrecognized_files(self):
        directory = self.state / "backups"
        (directory / "database-latest.dump").write_text("x")
        (directory / "database-1.dump.bak").write_text("x")
        plan = retention.plan_retention(self.root, self.state, None, None)
        self.assertEqual(plan["files"], [])

    def test_images_require_unambiguous_own_digest_and_preserve_containers(self):
        digest = "a" * 64
        live = "ghcr.io/gustathecreator/openathlete-api@sha256:" + digest
        old = "ghcr.io/gustathecreator/openathlete-api@sha256:" + "b" * 64
        other = "ghcr.io/other/openathlete-api@sha256:" + "c" * 64
        records = [
            {"reference": live, "id": "sha256:" + "1" * 64, "created": "2026-01-01", "repoTags": []},
            {"reference": old, "id": "sha256:" + "2" * 64, "created": "2025-01-01", "repoTags": []},
            {"reference": other, "id": "sha256:" + "3" * 64, "created": "2020-01-01", "repoTags": []},
            {"reference": old, "id": "sha256:" + "4" * 64, "created": "2024-01-01", "repoTags": ["openathlete-api:old"]},
        ]
        plan = retention.plan_retention(self.root, self.state, {"images": {"api": live}}, None,
                                        image_references=records, keep=1)
        self.assertEqual(plan["images"], [old])
        plan = retention.plan_retention(self.root, self.state, None, None, image_references=records,
                                        keep=1, container_image_ids=["sha256:" + "1" * 64])
        self.assertEqual(plan["images"], [old])

    def test_apply_requires_matching_restore_and_rechecks_file_hash(self):
        old = self.backup(1)
        self.backup(5)
        current_path = self.backup(9)
        source_hash = "c" * 64
        plan = retention.plan_retention(self.root, self.state,
                                        {"backup": str(current_path), "backupSourceSha256": source_hash},
                                        None, keep=1)
        with self.assertRaises(DeployError):
            retention.apply_retention(plan, None, "a" * 40, apply=True)
        receipt = {"result": "passed", "backupSha256": plan["backupSha256"],
                   "sourceSha256": source_hash, "migrationTree": "a" * 40}
        dry = retention.apply_retention(plan, receipt, "a" * 40)
        self.assertTrue(dry["dryRun"])
        old.write_bytes(b"modified after planning")
        result = retention.apply_retention(plan, receipt, "a" * 40, apply=True)
        self.assertTrue(old.exists())
        self.assertEqual(result["deleted"], ["database-5.dump"])
        self.assertEqual(result["errors"], [old.name])

    def test_image_remove_is_exact_digest_without_force_and_errors_are_recorded(self):
        image = "ghcr.io/gustathecreator/openathlete-web@sha256:" + "d" * 64
        plan = {"backupSha256": "e" * 64, "sourceSha256": "c" * 64, "files": [], "images": [image]}
        receipt = {"result": "passed", "backupSha256": "e" * 64,
                   "sourceSha256": "c" * 64, "migrationTree": "f" * 40}
        commands = []

        def runner(args):
            commands.append(args)
            raise DeployError("simulated image still referenced")

        result = retention.apply_retention(plan, receipt, "f" * 40, apply=True, docker_runner=runner)
        self.assertEqual(commands, [["docker", "image", "rm", image]])
        self.assertEqual(result["errors"], [image])

    def test_apply_rejects_source_archive_hash_mismatch_with_matching_backup_and_tree(self):
        plan = {"backupSha256": "e" * 64, "sourceSha256": "a" * 64, "files": [], "images": []}
        receipt = {"result": "passed", "backupSha256": "e" * 64,
                   "sourceSha256": "b" * 64, "migrationTree": "f" * 40}
        with self.assertRaisesRegex(DeployError, "source archive"):
            retention.apply_retention(plan, receipt, "f" * 40, apply=True)


class RestoreCheckTests(unittest.TestCase):
    def migration_archive(self, root, sql=b"SELECT 1;\n"):
        archive = Path(root) / "source.tar.gz"
        name = "20250101000000_test"
        lock = b'provider = "postgresql"\n'
        entries = {
            f"libs/database/prisma/schema/migrations/{name}/migration.sql": sql,
            "libs/database/prisma/schema/migrations/migration_lock.toml": lock,
        }
        with tarfile.open(archive, "w:gz") as bundle:
            for path, data in entries.items():
                info = tarfile.TarInfo(path)
                info.mode = 0o644
                info.size = len(data)
                bundle.addfile(info, io.BytesIO(data))

        def blob(data):
            framed = b"blob " + str(len(data)).encode() + b"\0" + data
            return hashlib.sha1(framed).digest()

        sql_oid, lock_oid = blob(sql), blob(lock)
        migration_tree_data = b"100644 migration.sql\0" + sql_oid
        migration_tree = hashlib.sha1(b"tree " + str(len(migration_tree_data)).encode() + b"\0" + migration_tree_data).digest()
        tree_data = (b"40000 " + name.encode() + b"\0" + migration_tree
                     + b"100644 migration_lock.toml\0" + lock_oid)
        tree_oid = hashlib.sha1(b"tree " + str(len(tree_data)).encode() + b"\0" + tree_data).hexdigest()
        return archive, hashlib.sha256(archive.read_bytes()).hexdigest(), tree_oid, name, hashlib.sha256(sql).hexdigest()

    def test_verifies_restore_against_source_archive_and_reports_only_receipt(self):
        with tempfile.TemporaryDirectory() as temp:
            backup = Path(temp) / "database.dump"
            backup.write_bytes(b"synthetic custom dump")
            archive, source_sha, tree, migration_name, sql_checksum = self.migration_archive(temp)
            commands = []

            def runner(args, input_stream=None, timeout=600):
                commands.append((args, input_stream))
                if args[:3] == ["docker", "inspect", "--format"]:
                    return b"healthy"
                if "pg_restore" in args:
                    self.assertEqual(input_stream.read(), b"synthetic custom dump")
                    return b""
                if "psql" in args:
                    return json.dumps([{"migration_name": migration_name, "checksum": sql_checksum,
                                        "finished": True, "rolled_back": False}]).encode()
                return b""

            receipt = restore_check.verify_backup(backup, tree, archive, source_sha, runner)
            self.assertEqual(receipt["result"], "passed")
            self.assertEqual(receipt["migrationCount"], 1)
            self.assertEqual(receipt["migrationTree"], tree)
            self.assertEqual(receipt["sourceSha256"], source_sha)
            serialized = str(receipt)
            self.assertNotIn(str(backup), serialized)
            start = commands[0][0]
            self.assertIn("--network", start)
            self.assertEqual(start[start.index("--network") + 1], "none")
            self.assertNotIn("--publish", start)
            self.assertTrue(any(command[0][1:3] == ["rm", "--force"] for command in commands))

    def test_rejects_bad_migration_tree_and_failed_migrations(self):
        with tempfile.TemporaryDirectory() as temp:
            backup = Path(temp) / "dump"
            backup.write_bytes(b"x")
            archive, source_sha, tree, name, checksum = self.migration_archive(temp)
            with self.assertRaises(DeployError):
                restore_check.verify_backup(backup, "bad", archive, source_sha, lambda *_args, **_kwargs: b"")
            with self.assertRaisesRegex(DeployError, "migration tree"):
                restore_check.verify_backup(backup, "a" * 40, archive, source_sha, lambda *_args, **_kwargs: b"")
            with self.assertRaisesRegex(DeployError, "SHA-256"):
                restore_check.verify_backup(backup, tree, archive, "0" * 64, lambda *_args, **_kwargs: b"")
            calls = []

            def runner(args, **_kwargs):
                calls.append(args)
                if args[:3] == ["docker", "inspect", "--format"]:
                    return b"healthy"
                if "psql" in args:
                    return json.dumps([{"migration_name": name, "checksum": checksum,
                                        "finished": True, "rolled_back": True}]).encode()
                return b""

            with self.assertRaisesRegex(DeployError, "migration history"):
                restore_check.verify_backup(backup, tree, archive, source_sha, runner)
            self.assertTrue(any(args[1:3] == ["rm", "--force"] for args in calls))

    def test_rejects_wrong_sql_history_even_when_archive_and_tree_are_valid(self):
        with tempfile.TemporaryDirectory() as temp:
            backup = Path(temp) / "dump"
            backup.write_bytes(b"x")
            archive, source_sha, tree, name, _checksum = self.migration_archive(temp)
            calls = []

            def runner(args, **_kwargs):
                calls.append(args)
                if args[:3] == ["docker", "inspect", "--format"]:
                    return b"healthy"
                if "psql" in args:
                    return json.dumps([{"migration_name": name, "checksum": "0" * 64,
                                        "finished": True, "rolled_back": False}]).encode()
                return b""

            with self.assertRaisesRegex(DeployError, "does not match the source archive"):
                restore_check.verify_backup(backup, tree, archive, source_sha, runner)
            self.assertTrue(any(args[1:3] == ["rm", "--force"] for args in calls))


if __name__ == "__main__":
    unittest.main()
