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


class ManifestTests(unittest.TestCase):
    def test_accepts_exact_release_manifest(self):
        self.assertEqual(deployer.validate_manifest(MANIFEST, TAG, URL), MANIFEST)

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

    def fake_run(self, args, **kwargs):
        self.commands.append(list(args))
        if args[:2] == ["docker", "pull"]:
            self.pull_count += 1
            return b"pulled"
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
            value = {"Id": ident, "Image": f"image-{service}", "Config": {"Labels": {"com.docker.compose.service": service}}, "State": state}
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
        if url == URL:
            return self.archive
        raise AssertionError(f"Unexpected URL: {url}")

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
