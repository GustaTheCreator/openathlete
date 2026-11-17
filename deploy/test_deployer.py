import hashlib
import json
import tempfile
import unittest
import copy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import deployer


TAG = "tourmalet-v1.6.1"
URL = f"https://github.com/{deployer.REPOSITORY}/releases/download/{TAG}/openathlete-{TAG}.tar.gz"
MANIFEST = {
    "schemaVersion": 1,
    "version": "1.6.1",
    "tag": TAG,
    "revision": "a" * 40,
    "migrationTree": "b" * 40,
    "images": {
        "api": "ghcr.io/gustathecreator/openathlete-api@sha256:" + "c" * 64,
        "web": "ghcr.io/gustathecreator/openathlete-web@sha256:" + "d" * 64,
    },
    "source": {"url": URL, "sha256": "e" * 64},
}
V2_TAG = "tourmalet-v1.7.0"
V2_URL = f"https://github.com/{deployer.REPOSITORY}/releases/download/{V2_TAG}/openathlete-{V2_TAG}.tar.gz"
V2_MANIFEST = {
    "schemaVersion": 2, "version": "1.7.0", "tag": V2_TAG,
    "revision": "f" * 40, "migrationTree": "b" * 40,
    "images": {name: f"ghcr.io/gustathecreator/openathlete-{'api' if name == 'migrator' else name}@sha256:{letter * 64}"
               for name, letter in (("api", "c"), ("web", "d"), ("migrator", "e"))},
    "source": {"url": V2_URL, "sha256": "e" * 64},
    "components": {
        "api": {"revision": "a" * 40, "version": "1.6.9", "inputs": "1" * 64},
        "web": {"revision": "b" * 40, "version": "1.7.0", "inputs": "2" * 64},
        "migrator": {"revision": "c" * 40, "version": "1.6.8", "inputs": "3" * 64},
    },
}


class ManifestTests(unittest.TestCase):
    def test_accepts_exact_release_manifest(self):
        self.assertEqual(deployer.validate_manifest(MANIFEST, TAG, URL), MANIFEST)

    def test_accepts_v2_and_verifies_component_specific_labels(self):
        manifest = deployer.validate_manifest(V2_MANIFEST, V2_TAG, V2_URL)
        labels = [deployer.expected_labels(manifest, component) for component in deployer.names(manifest)]
        self.assertEqual([label["org.opencontainers.image.revision"] for label in labels],
                         ["a" * 40, "b" * 40, "c" * 40])
        self.assertEqual([label["org.opencontainers.image.version"] for label in labels], ["1.6.9", "1.7.0", "1.6.8"])
        with patch.object(deployer, "_image_metadata", side_effect=lambda image: {
            component: deployer.expected_labels(manifest, component)
            for component in deployer.names(manifest)
        }[next(component for component in deployer.names(manifest) if manifest["images"][component] == image)]) as metadata:
            deployer._verify_images(manifest)
        self.assertEqual(metadata.call_count, 3)

    def test_rejects_other_repository_or_archive(self):
        for bad_url in (URL.replace("GustaTheCreator", "attacker"), URL + "?download=1"):
            with self.subTest(url=bad_url), self.assertRaises(deployer.DeployError):
                deployer.validate_manifest(MANIFEST, TAG, bad_url)

    def test_rejects_unstable_or_mismatched_tag(self):
        manifest = dict(MANIFEST, version="1.6.1-rc.1")
        with self.assertRaises(deployer.DeployError):
            deployer.validate_manifest(manifest, TAG, URL)

    def test_rejects_digest_outside_fixed_image_repositories(self):
        images = dict(MANIFEST["images"], web="ghcr.io/attacker/web@sha256:" + "d" * 64)
        with self.assertRaises(deployer.DeployError):
            deployer.validate_manifest(dict(MANIFEST, images=images), TAG, URL)

    def test_invalid_migration_tree_stops_before_any_container_action(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "compose.yml").write_text("services: {}\n", encoding="utf-8")
            cfg = {"root": str(root), "repository": deployer.REPOSITORY, "composeFiles": ["compose.yml"],
                   "project": "openathlete", "postgresService": "postgres", "allowedMigrationTrees": ["f" * 40], "healthTimeoutSeconds": 90}
            with patch.object(deployer, "_github_release", return_value=(TAG, {"manifest": "m", "source": URL})), \
                    patch.object(deployer, "_request", return_value=json.dumps(MANIFEST).encode()), \
                    patch.object(deployer, "_run") as run:
                with self.assertRaisesRegex(deployer.DeployError, "Migration tree"):
                    deployer._check_release(cfg, root / ".deploy")
                run.assert_not_called()

    def test_sha_mismatch_is_rejected(self):
        with self.assertRaisesRegex(deployer.DeployError, "SHA-256"):
            deployer._verify_archive(b"not the release artifact", "e" * 64)

    def test_downgrade_is_rejected_and_identical_release_is_noop(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "compose.yml").write_text("services: {}\n", encoding="utf-8")
            state = root / ".deploy"
            state.mkdir()
            cfg = {"root": str(root), "repository": deployer.REPOSITORY, "composeFiles": ["compose.yml"],
                   "project": "openathlete", "postgresService": "postgres", "allowedMigrationTrees": ["b" * 40], "healthTimeoutSeconds": 90}
            current = {"version": "1.6.2", "revision": "a" * 40}
            (state / "current.json").write_text(json.dumps(current), encoding="utf-8")
            with patch.object(deployer, "_github_release", return_value=(TAG, {"manifest": "m", "source": URL})), \
                    patch.object(deployer, "_request", return_value=json.dumps(MANIFEST).encode()):
                with self.assertRaisesRegex(deployer.DeployError, "Downgrades"):
                    deployer._check_release(cfg, state)
            current["version"] = "1.6.1"
            current["manifestFingerprint"] = deployer._manifest_fingerprint(MANIFEST)
            (state / "current.json").write_text(json.dumps(current), encoding="utf-8")
            with patch.object(deployer, "_github_release", return_value=(TAG, {"manifest": "m", "source": URL})), \
                    patch.object(deployer, "_request", return_value=json.dumps(MANIFEST).encode()):
                manifest, message = deployer._check_release(cfg, state)
            self.assertIsNone(manifest)
            self.assertIn("Already on", message)

    def test_same_version_revision_cannot_change_digest_identity(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "compose.yml").write_text("services: {}\n", encoding="utf-8")
            state = root / ".deploy"
            state.mkdir()
            current = {"version": "1.6.1", "revision": "a" * 40,
                       "manifestFingerprint": deployer._manifest_fingerprint(MANIFEST)}
            (state / "current.json").write_text(json.dumps(current), encoding="utf-8")
            altered = copy.deepcopy(MANIFEST)
            altered["images"]["web"] = "ghcr.io/gustathecreator/openathlete-web@sha256:" + "f" * 64
            cfg = {"root": str(root), "repository": deployer.REPOSITORY, "composeFiles": ["compose.yml"],
                   "project": "openathlete", "postgresService": "postgres", "allowedMigrationTrees": ["b" * 40], "healthTimeoutSeconds": 90}
            with patch.object(deployer, "_github_release", return_value=(TAG, {"manifest": "m", "source": URL})), \
                    patch.object(deployer, "_request", return_value=json.dumps(altered).encode()):
                with self.assertRaisesRegex(deployer.DeployError, "different image or source"):
                    deployer._check_release(cfg, state)

    def test_only_exact_stable_public_github_assets_are_selected(self):
        def release(tag, *, draft=False, prerelease=False):
            base = f"https://github.com/{deployer.REPOSITORY}/releases/download/{tag}/"
            return {"tag_name": tag, "draft": draft, "prerelease": prerelease, "assets": [
                {"name": deployer.MANIFEST_NAME, "browser_download_url": base + deployer.MANIFEST_NAME},
                {"name": deployer.SOURCE_NAME.format(tag=tag), "browser_download_url": base + deployer.SOURCE_NAME.format(tag=tag)},
            ]}
        payload = [release("tourmalet-v9.0.0", draft=True), release("tourmalet-v8.0.0", prerelease=True),
                   release("tourmalet-v1.6.1")]
        with patch.object(deployer, "_request", return_value=json.dumps(payload).encode()):
            found = deployer._github_release()
        self.assertEqual(found[0], TAG)


class ConfigTests(unittest.TestCase):
    def test_legacy_config_disables_retention_and_v2_retention_is_strict(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "compose.yml").write_text("services: {}\n", encoding="utf-8")
            config_path = root / "config.json"
            config = {"root": str(root), "repository": deployer.REPOSITORY,
                      "composeFiles": ["compose.yml"], "project": "openathlete",
                      "postgresService": "postgres", "allowedMigrationTrees": ["a" * 40],
                      "healthTimeoutSeconds": 90}
            config_path.write_text(json.dumps(config), encoding="utf-8")
            self.assertNotIn("retention", deployer.load_config(config_path))
            config["retention"] = {"enabled": True, "keep": 3, "pins": ["legacy.dump"]}
            config_path.write_text(json.dumps(config), encoding="utf-8")
            self.assertTrue(deployer.load_config(config_path)["retention"]["enabled"])
            config["retention"]["unexpected"] = True
            config_path.write_text(json.dumps(config), encoding="utf-8")
            with self.assertRaisesRegex(deployer.DeployError, "retention"):
                deployer.load_config(config_path)


class FilesystemTests(unittest.TestCase):
    def test_generated_override_changes_only_app_images_and_adds_readonly_source(self):
        with tempfile.TemporaryDirectory() as temp:
            data = json.loads(deployer._make_override(Path(temp), MANIFEST))
        self.assertEqual(set(data["services"]), {"api", "web"})
        self.assertEqual(data["services"]["api"]["image"], MANIFEST["images"]["api"])
        self.assertNotIn("build", data["services"]["api"])
        self.assertNotIn("build", data["services"]["web"])
        self.assertTrue(all(volume["read_only"] for volume in data["services"]["web"]["volumes"]))
        self.assertIn("openathlete-tourmalet-v1.6.1.tar.gz", data["services"]["web"]["volumes"][1]["source"])

    def test_v2_override_skips_api_migrations_and_sets_versioned_source_url(self):
        with tempfile.TemporaryDirectory() as temp:
            data = json.loads(deployer._make_override(Path(temp), V2_MANIFEST))
        self.assertEqual(data["services"]["api"]["environment"], {"SKIP_MIGRATIONS": "true"})
        self.assertEqual(data["services"]["web"]["environment"]["SOURCE_CODE_URL"],
                         f"https://github.com/{deployer.REPOSITORY}/tree/{V2_TAG}")

    def test_private_atomic_write_and_sha_check(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / ".deploy" / "archive"
            deployer._write_private(path, b"fixture archive")
            self.assertEqual(path.read_bytes(), b"fixture archive")
            self.assertEqual(deployer._file_hash(path), hashlib.sha256(b"fixture archive").hexdigest())
            if hasattr(deployer.os, "fchmod"):
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)

class DeploymentFlowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "docker-compose.yml").write_text("services: {}\n", encoding="utf-8")
        (self.root / "docker-compose.override.yml").write_text("services: {}\n", encoding="utf-8")
        (self.root / "public-source").mkdir()
        (self.root / "public-source" / "openathlete.tar.gz").write_bytes(b"old public source")
        (self.root / ".env").write_bytes(b"private values stay outside assertions")
        self.state = self.root / ".deploy"
        self.state.mkdir()
        self.archive = b"new verified source archive"
        self.manifest = copy.deepcopy(MANIFEST)
        self.manifest["source"]["sha256"] = hashlib.sha256(self.archive).hexdigest()
        self.urls = {"manifest": "manifest-asset", "source": URL}
        self.cfg = {"root": str(self.root), "repository": deployer.REPOSITORY,
                    "composeFiles": ["docker-compose.yml", "docker-compose.override.yml"],
                    "project": "openathlete", "postgresService": "postgres",
                    "allowedMigrationTrees": ["b" * 40], "healthTimeoutSeconds": 15}
        self.commands = []
        self.backup_args = None
        self.up_count = 0
        self.pull_count = 0
        self.fail_up_at = None
        self.fail_migrator = False
        self.live_api_image = "image-api"
        self.migrator_env = None

    def fake_run(self, args, **kwargs):
        self.commands.append(list(args))
        if args[:2] == ["docker", "logs"]:
            return (b"2026-11-17T12:00:01Z Running prisma migrate deploy...\n"
                    b"2026-11-17T12:00:04Z Migrations completed successfully\n")
        if args[:2] == ["docker", "pull"]:
            self.pull_count += 1
            return b"pulled"
        if args[:3] == ["docker", "image", "inspect"]:
            return b"target-api-image"
        if args[:2] == ["docker", "run"]:
            self.migrator_env = kwargs.get("env")
            if self.fail_migrator:
                raise deployer.DeployError("simulated migration failure")
            return b"migrations applied"
        if args[:3] == ["docker", "rm", "--force"]:
            return b"removed"
        if args[:2] == ["docker", "compose"] and "config" in args:
            return json.dumps({
                "services": {
                    "api": {"environment": {"DATABASE_URL": "postgresql://oa:private@postgres:5432/oa"},
                            "networks": {"app": {}}},
                    "postgres": {"networks": {"app": {}}},
                },
                "networks": {"app": {"name": "openathlete_app"}},
            }).encode()
        if args[:2] == ["docker", "compose"] and "ps" in args:
            if args[-1:] == ["postgres"]:
                return b"postgres-id\n"
            return b"api-id\nweb-id\npostgres-id\n"
        if args[:2] == ["docker", "inspect"]:
            ident = args[2]
            service = {"api-id": "api", "web-id": "web", "postgres-id": "postgres"}[ident]
            state = {"Status": "running", "StartedAt": f"started-{service}"}
            if service == "web":
                state["Health"] = {"Status": "healthy"}
            value = {"Id": ident, "Image": self.live_api_image if service == "api" else f"image-{service}",
                     "Config": {"Labels": {"com.docker.compose.service": service}}, "State": state}
            return json.dumps([value]).encode()
        if args[:2] == ["docker", "exec"]:
            self.backup_args = list(args)
            return b"database backup fixture"
        if "up" in args:
            self.up_count += 1
            if self.fail_up_at == self.up_count:
                raise deployer.DeployError("simulated compose failure")
            return b"started"
        raise AssertionError(f"Unexpected fake command: {args[:4]}")

    def request(self, url, limit=2_000_000):
        if url == "manifest-asset":
            return json.dumps(self.manifest).encode()
        if url == self.manifest["source"]["url"]:
            return self.archive
        raise AssertionError(f"Unexpected URL: {url}")

    def use_v2(self):
        self.manifest = copy.deepcopy(V2_MANIFEST)
        self.manifest["source"]["sha256"] = hashlib.sha256(self.archive).hexdigest()
        self.urls = {"manifest": "manifest-asset", "source": V2_URL}

    def test_v2_migrates_after_backup_and_before_application_cutover(self):
        self.use_v2()
        with patch.object(deployer, "_github_release", return_value=(V2_TAG, self.urls)), \
                patch.object(deployer, "_request", side_effect=self.request), \
                patch.object(deployer, "_run", side_effect=self.fake_run), \
                patch.object(deployer, "_verify_images"), \
                patch.object(deployer, "_wait_health"):
            self.assertEqual(deployer.deploy(self.cfg, self.state), 0)
        backup_index = next(i for i, args in enumerate(self.commands) if args[:2] == ["docker", "exec"])
        migrate_index = next(i for i, args in enumerate(self.commands) if args[:2] == ["docker", "run"])
        activation_index = next(i for i, args in enumerate(self.commands)
                                if args[:2] == ["docker", "compose"] and "up" in args)
        self.assertLess(backup_index, migrate_index)
        self.assertLess(migrate_index, activation_index)
        migrate_args = self.commands[migrate_index]
        self.assertIn("openathlete_app", migrate_args)
        self.assertNotIn("oa:private", " ".join(migrate_args))
        self.assertEqual(self.migrator_env["DATABASE_URL"], "postgresql://oa:private@postgres:5432/oa")
        self.assertEqual(self.migrator_env["CHECKPOINT_DISABLE"], "1")
        current = json.loads((self.state / "current.json").read_text(encoding="utf-8"))
        self.assertEqual(current["schemaVersion"], 2)
        self.assertEqual(current["components"], V2_MANIFEST["components"])
        self.assertIsNone(current["backupMigrationTree"])

    def test_v2_migration_failure_rejects_release_without_cutover_or_restore(self):
        self.use_v2()
        self.fail_migrator = True
        with patch.object(deployer, "_github_release", return_value=(V2_TAG, self.urls)), \
                patch.object(deployer, "_request", side_effect=self.request), \
                patch.object(deployer, "_run", side_effect=self.fake_run), \
                patch.object(deployer, "_verify_images"), \
                patch.object(deployer, "_wait_health") as health:
            with self.assertRaisesRegex(deployer.DeployError, "not automatically restored"):
                deployer.deploy(self.cfg, self.state)
        self.assertEqual(self.up_count, 0)
        self.assertEqual((self.root / "public-source" / "openathlete.tar.gz").read_bytes(), b"old public source")
        self.assertEqual(sum(args[:2] == ["docker", "exec"] for args in self.commands), 1)
        self.assertTrue(any(args[:3] == ["docker", "rm", "--force"] for args in self.commands))
        rejected = json.loads((self.state / "rejected.json").read_text(encoding="utf-8"))
        self.assertEqual(rejected["releases"][-1]["reason"], "migration_failed")
        health.assert_not_called()

    def test_v2_same_migration_tree_reuses_api_image_without_recreating_it(self):
        self.use_v2()
        self.live_api_image = "target-api-image"
        (self.state / "current.json").write_text(json.dumps({
            "schemaVersion": 2, "version": "1.6.9", "revision": "a" * 40,
            "migrationTree": "b" * 40, "tag": V2_TAG, "sourceSha256": "9" * 64,
            "images": V2_MANIFEST["images"],
        }), encoding="utf-8")
        with patch.object(deployer, "_github_release", return_value=(V2_TAG, self.urls)), \
                patch.object(deployer, "_request", side_effect=self.request), \
                patch.object(deployer, "_run", side_effect=self.fake_run), \
                patch.object(deployer, "_verify_images"), \
                patch.object(deployer, "_wait_health"):
            self.assertEqual(deployer.deploy(self.cfg, self.state), 0)
        self.assertFalse(any(args[:2] == ["docker", "run"] for args in self.commands))
        activation = next(args for args in self.commands if args[:2] == ["docker", "compose"] and "up" in args)
        self.assertEqual(activation[-1], "web")
        self.assertNotIn("api", activation[activation.index("never") + 1:])

    def test_configured_retention_verifies_backup_and_runs_after_receipt_write(self):
        self.use_v2()
        self.cfg["retention"] = {"enabled": True, "keep": 2, "pins": ["database-legacy.dump"]}
        (self.state / "current.json").write_text(json.dumps({
            "schemaVersion": 2, "version": "1.6.9", "revision": "a" * 40,
            "migrationTree": "b" * 40, "tag": V2_TAG, "sourceSha256": "9" * 64,
            "images": V2_MANIFEST["images"],
        }), encoding="utf-8")
        restored = {"result": "passed", "backupSha256": "1" * 64,
                    "migrationTree": "b" * 40, "migrationCount": 139}
        import restore_check
        import retention
        with patch.object(deployer, "_github_release", return_value=(V2_TAG, self.urls)), \
                patch.object(deployer, "_request", side_effect=self.request), \
                patch.object(deployer, "_run", side_effect=self.fake_run), \
                patch.object(deployer, "_verify_images"), \
                patch.object(deployer, "_wait_health"), \
                patch.object(restore_check, "verify_backup", return_value=restored) as verify, \
                patch.object(deployer, "_retention_image_inventory", return_value=([], [])), \
                patch.object(retention, "plan_retention", return_value={"backupSha256": "1" * 64}) as plan, \
                patch.object(retention, "apply_retention", return_value={"errors": [], "deleted": ["old.dump"]}) as apply:
            self.assertEqual(deployer.deploy(self.cfg, self.state), 0)
        current = json.loads((self.state / "current.json").read_text(encoding="utf-8"))
        verify.assert_called_once()
        self.assertEqual(verify.call_args.args[1:], ("b" * 40, deployer._source_file(self.root, V2_TAG), "9" * 64))
        plan.assert_called_once()
        apply.assert_called_once_with(plan.return_value, restored, "b" * 40, apply=True)
        self.assertEqual(current["schemaVersion"], 2)
        self.assertEqual(current["backupSourceTag"], V2_TAG)
        self.assertEqual(current["backupSourceSha256"], "9" * 64)
        self.assertEqual(current["sourceArchive"], str(deployer._source_file(self.root, V2_TAG)))

    def test_retention_restore_failure_warns_without_rolling_back_healthy_release(self):
        self.use_v2()
        self.cfg["retention"] = {"enabled": True, "keep": 2, "pins": []}
        (self.state / "current.json").write_text(json.dumps({
            "schemaVersion": 2, "version": "1.6.9", "revision": "a" * 40,
            "migrationTree": "b" * 40, "images": V2_MANIFEST["images"],
        }), encoding="utf-8")
        import restore_check
        with patch.object(deployer, "_github_release", return_value=(V2_TAG, self.urls)), \
                patch.object(deployer, "_request", side_effect=self.request), \
                patch.object(deployer, "_run", side_effect=self.fake_run), \
                patch.object(deployer, "_verify_images"), \
                patch.object(deployer, "_wait_health"), \
                patch.object(restore_check, "verify_backup", side_effect=deployer.DeployError("restore failed")), \
                patch.object(deployer, "log") as logger:
            self.assertEqual(deployer.deploy(self.cfg, self.state), 0)
        self.assertTrue(any("WARNING: artifact retention" in call.args[0] for call in logger.call_args_list))
        self.assertTrue((self.state / "current.json").exists())
        self.assertEqual(self.up_count, 1)

    def test_failed_activation_restores_source_and_blocks_the_next_poll(self):
        with patch.object(deployer, "_github_release", return_value=(TAG, self.urls)), \
                patch.object(deployer, "_request", side_effect=self.request), \
                patch.object(deployer, "_run", side_effect=self.fake_run), \
                patch.object(deployer, "_verify_images"), \
                patch.object(deployer, "_wait_health") as health:
            health.side_effect = [deployer.DeployError("new api is unhealthy"), None]
            with self.assertRaisesRegex(deployer.DeployError, "unhealthy"):
                deployer.deploy(self.cfg, self.state)
            self.assertEqual((self.root / "public-source" / "openathlete.tar.gz").read_bytes(), b"old public source")
            self.assertEqual((self.root / ".env").read_bytes(), b"private values stay outside assertions")
            self.assertFalse((self.state / "release.json").exists())
            self.assertEqual(self.up_count, 2)
            pulls = self.pull_count
            self.assertEqual(deployer.deploy(self.cfg, self.state), 0)
            self.assertEqual(self.pull_count, pulls)

    def test_rejected_state_write_failure_still_restores_failed_activation(self):
        write_private = deployer._write_private
        def fail_rejected(path, data):
            if Path(path).name == "rejected.json":
                raise OSError("simulated state disk failure")
            return write_private(path, data)
        with patch.object(deployer, "_github_release", return_value=(TAG, self.urls)), \
                patch.object(deployer, "_request", side_effect=self.request), \
                patch.object(deployer, "_run", side_effect=self.fake_run), \
                patch.object(deployer, "_verify_images"), \
                patch.object(deployer, "_wait_health") as health, \
                patch.object(deployer, "_write_private", side_effect=fail_rejected):
            health.side_effect = [deployer.DeployError("new api is unhealthy"), None]
            with self.assertRaisesRegex(deployer.DeployError, "retry guard could not be saved"):
                deployer.deploy(self.cfg, self.state)
        self.assertEqual(self.up_count, 2)
        self.assertEqual((self.root / "public-source" / "openathlete.tar.gz").read_bytes(), b"old public source")
        self.assertEqual((self.root / ".env").read_bytes(), b"private values stay outside assertions")

    def test_manual_rollback_still_restores_if_rejected_state_write_fails(self):
        with patch.object(deployer, "_github_release", return_value=(TAG, self.urls)), \
                patch.object(deployer, "_request", side_effect=self.request), \
                patch.object(deployer, "_run", side_effect=self.fake_run), \
                patch.object(deployer, "_verify_images"), \
                patch.object(deployer, "_wait_health"):
            deployer.deploy(self.cfg, self.state)
        write_private = deployer._write_private
        def fail_rejected(path, data):
            if Path(path).name == "rejected.json":
                raise OSError("simulated state disk failure")
            return write_private(path, data)
        previous_up_count = self.up_count
        with patch.object(deployer, "_run", side_effect=self.fake_run), \
                patch.object(deployer, "_wait_health") as health, \
                patch.object(deployer, "_write_private", side_effect=fail_rejected):
            with self.assertRaisesRegex(deployer.DeployError, "automatic reapply guard could not be saved"):
                deployer.rollback(self.cfg, self.state)
        self.assertEqual(self.up_count, previous_up_count + 1)
        health.assert_called_once()
        self.assertFalse((self.state / "current.json").exists())
        self.assertFalse((self.state / "release.json").exists())
        self.assertEqual((self.root / ".env").read_bytes(), b"private values stay outside assertions")

    def test_success_then_manual_rollback_is_health_verified_and_not_redeployed(self):
        with patch.object(deployer, "_github_release", return_value=(TAG, self.urls)), \
                patch.object(deployer, "_request", side_effect=self.request), \
                patch.object(deployer, "_run", side_effect=self.fake_run), \
                patch.object(deployer, "_verify_images"), \
                patch.object(deployer, "_wait_health") as health:
            health.side_effect = [None, None]
            self.assertEqual(deployer.deploy(self.cfg, self.state), 0)
            active = json.loads((self.state / "current.json").read_text(encoding="utf-8"))
            self.assertIn("phaseTimingsSeconds", active)
            self.assertIn("deployElapsedSeconds", active)
            self.assertIn("database_backup", active["phaseTimingsSeconds"])
            self.assertIn("container_activation", active["phaseTimingsSeconds"])
            self.assertIn("health_wait", active["phaseTimingsSeconds"])
            self.assertEqual(active["databaseMigrationSeconds"], 3)
            self.assertGreaterEqual(active["deployElapsedSeconds"], 0)
            self.assertEqual(active["manifestFingerprint"], deployer._manifest_fingerprint(self.manifest))
            self.assertEqual(active["images"], self.manifest["images"])
            self.assertEqual(active["sourceSha256"], self.manifest["source"]["sha256"])
            self.assertIn('"$POSTGRES_USER"', self.backup_args[-1])
            self.assertIn('"$POSTGRES_DB"', self.backup_args[-1])
            self.assertNotIn("openathlete", self.backup_args)
            self.assertEqual((self.root / ".env").read_bytes(), b"private values stay outside assertions")
            self.assertEqual(deployer.rollback(self.cfg, self.state), 0)
            self.assertEqual(health.call_count, 2)
            self.assertEqual((self.root / "public-source" / "openathlete.tar.gz").read_bytes(), b"old public source")
            self.assertFalse((self.state / "current.json").exists())
            pulls = self.pull_count
            self.assertEqual(deployer.deploy(self.cfg, self.state), 0)
            self.assertEqual(self.pull_count, pulls)

    def test_bad_source_hash_and_database_backup_failure_do_not_cut_over(self):
        self.manifest["source"]["sha256"] = "0" * 64
        with patch.object(deployer, "_github_release", return_value=(TAG, self.urls)), \
                patch.object(deployer, "_request", side_effect=self.request), \
                patch.object(deployer, "_run", side_effect=self.fake_run), \
                patch.object(deployer, "_verify_images"):
            with self.assertRaisesRegex(deployer.DeployError, "SHA-256"):
                deployer.deploy(self.cfg, self.state)
        self.assertEqual(self.up_count, 0)
        self.assertEqual((self.root / "public-source" / "openathlete.tar.gz").read_bytes(), b"old public source")

        self.manifest["source"]["sha256"] = hashlib.sha256(self.archive).hexdigest()
        self.commands.clear()
        def fail_backup(args, **kwargs):
            if args[:2] == ["docker", "exec"]:
                raise deployer.DeployError("simulated pg_dump failure")
            return self.fake_run(args, **kwargs)
        with patch.object(deployer, "_github_release", return_value=(TAG, self.urls)), \
                patch.object(deployer, "_request", side_effect=self.request), \
                patch.object(deployer, "_run", side_effect=fail_backup), \
                patch.object(deployer, "_verify_images"):
            with self.assertRaisesRegex(deployer.DeployError, "pg_dump"):
                deployer.deploy(self.cfg, self.state)
        self.assertEqual(self.up_count, 0)
        self.assertEqual((self.root / "public-source" / "openathlete.tar.gz").read_bytes(), b"old public source")

    def test_failed_manual_rollback_raises_and_keeps_current_metadata(self):
        with patch.object(deployer, "_github_release", return_value=(TAG, self.urls)), \
                patch.object(deployer, "_request", side_effect=self.request), \
                patch.object(deployer, "_run", side_effect=self.fake_run), \
                patch.object(deployer, "_verify_images"), \
                patch.object(deployer, "_wait_health"):
            deployer.deploy(self.cfg, self.state)
        before = (self.state / "current.json").read_bytes()
        self.fail_up_at = self.up_count + 1
        with patch.object(deployer, "_run", side_effect=self.fake_run), \
                patch.object(deployer, "_wait_health") as health:
            with self.assertRaisesRegex(deployer.DeployError, "Manual rollback failed"):
                deployer.rollback(self.cfg, self.state)
        self.assertEqual((self.state / "current.json").read_bytes(), before)
        rejected = json.loads((self.state / "rejected.json").read_text(encoding="utf-8"))
        self.assertEqual(rejected["releases"][-1]["reason"], "manual_rollback")
        pulls = self.pull_count
        with patch.object(deployer, "_github_release", return_value=(TAG, self.urls)), \
                patch.object(deployer, "_request", side_effect=self.request), \
                patch.object(deployer, "_run", side_effect=self.fake_run):
            self.assertEqual(deployer.deploy(self.cfg, self.state), 0)
        self.assertEqual(self.pull_count, pulls)


class HealthTests(unittest.TestCase):
    def test_status_rechecks_live_images_and_health_instead_of_trusting_receipt(self):
        state = Path("unused-state")
        current = {"version": "1.7.3", "revision": "a" * 40, "images": {"api": "api@digest", "web": "web@digest"}}
        with patch.object(deployer, "_read_state", return_value=current), \
                patch.object(deployer, "_containers", return_value={"api": {"image": "image-id"}, "web": {"image": "image-id"}}) as containers, \
                patch.object(deployer, "_run", return_value=b"image-id"), \
                patch.object(deployer, "_wait_health") as health, \
                patch.object(deployer, "log"):
            self.assertEqual(deployer.status({}, state), 0)
            health.assert_called_once()
            containers.return_value["api"]["image"] = "drifted"
            with self.assertRaisesRegex(deployer.DeployError, "differs"):
                deployer.status({}, state)
            self.assertEqual(health.call_count, 1)

    def test_status_retention_preview_failure_does_not_mask_healthy_runtime(self):
        state = Path("unused-state")
        current = {"version": "1.7.0", "revision": "a" * 40,
                   "images": {"api": "api@digest", "web": "web@digest"}}
        cfg = {"retention": {"enabled": True, "keep": 3, "pins": ["legacy.dump"]}}
        with patch.object(deployer, "_read_state", side_effect=[current, {"current": None}]), \
                patch.object(deployer, "_containers", return_value={"api": {"image": "image-id"}, "web": {"image": "image-id"}}), \
                patch.object(deployer, "_run", return_value=b"image-id"), \
                patch.object(deployer, "_wait_health") as health, \
                patch.object(deployer, "_retention_image_inventory", side_effect=deployer.DeployError("inspect failed")), \
                patch.object(deployer, "log") as logger:
            self.assertEqual(deployer.status(cfg, state), 0)
        health.assert_called_once()
        self.assertTrue(any("WARNING: artifact retention preview" in call.args[0] for call in logger.call_args_list))

    def test_migration_duration_uses_only_the_entrypoint_timestamped_pair(self):
        self.assertEqual(deployer._migration_seconds(
            "unrelated private log ignored\n2026-11-17T12:00:01Z Running prisma migrate deploy...\n"
            "2026-11-17T12:00:04Z Migrations completed successfully\n"), 3)
        self.assertIsNone(deployer._migration_seconds("Skipping database migrations"))

    def test_api_probe_failure_times_out_instead_of_marking_api_healthy(self):
        cfg = {"healthTimeoutSeconds": 15}
        state = Path("unused-state")
        info = {"State": {"Status": "running"}}
        with patch.object(deployer, "_containers", return_value={"api": {"id": "api-id"}}), \
                patch.object(deployer, "_run", return_value=json.dumps([info]).encode()), \
                patch.object(deployer.subprocess, "run", return_value=SimpleNamespace(returncode=1)) as probe, \
                patch.object(deployer.time, "monotonic", side_effect=[0, 0, 20]), \
                patch.object(deployer.time, "sleep"):
            with self.assertRaisesRegex(deployer.DeployError, "did not become healthy"):
                deployer._wait_health(cfg, state)
        probe.assert_called_once()

    def test_restore_failure_does_not_mark_old_version_current(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            state = root / ".deploy"
            state.mkdir()
            (root / "public-source").mkdir()
            stable = root / "public-source" / "openathlete.tar.gz"
            stable.write_bytes(b"same archive")
            current = {"version": "1.6.2", "revision": "c" * 40}
            old_current = {"version": "1.6.1", "revision": "a" * 40}
            current_path = state / "current.json"
            current_path.write_text(json.dumps(current), encoding="utf-8")
            cfg = {"root": str(root), "composeFiles": [], "project": "openathlete"}
            snapshot = {"override": None, "stableSourceSha256": deployer._file_hash(stable),
                        "stableSourceBackup": None, "current": old_current}
            with patch.object(deployer, "_run", return_value=b""), \
                    patch.object(deployer, "_wait_health", side_effect=deployer.DeployError("restored version unhealthy")):
                with self.assertRaisesRegex(deployer.DeployError, "restored version unhealthy"):
                    deployer._restore(cfg, state, snapshot)
            self.assertEqual(json.loads(current_path.read_text(encoding="utf-8")), current)


if __name__ == "__main__":
    unittest.main()
