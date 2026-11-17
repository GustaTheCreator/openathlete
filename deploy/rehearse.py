#!/usr/bin/env python3
"""Rehearse a release's database migrations on disposable synthetic data."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any

from deployer import DeployError, REPOSITORY_URL, _github_release, _request, parse_version, validate_manifest

IMAGE = re.compile(r"^ghcr\.io/gustathecreator/openathlete-(?:api|migrator)@sha256:[a-f0-9]{64}$")
REVISION = re.compile(r"^[a-f0-9]{40}$")
FIXTURE = "workflow-migration-rehearsal-v1"
POSTGRES_IMAGE = "pgvector/pgvector:pg17"


def baseline_for(revision: str) -> dict[str, str]:
    if not REVISION.fullmatch(revision):
        raise DeployError("Candidate revision must be a full Git object ID")
    tree = _run(["git", "rev-parse", f"{revision}:libs/database/prisma/schema/migrations"]).decode().strip()
    if not REVISION.fullmatch(tree):
        raise DeployError("Candidate migration tree is invalid")
    found = _github_release()
    if not found:
        return {"rehearsal-needed": "false", "base-api-image": ""}
    tag, urls = found
    manifest = validate_manifest(json.loads(_request(urls["manifest"], 100_000)), tag, urls["source"])
    return {"rehearsal-needed": str(manifest["migrationTree"] != tree).lower(),
            "base-api-image": manifest["images"].get("migrator", manifest["images"]["api"])}


def _run(args: list[str], *, input_data: bytes | None = None, timeout: int = 180) -> bytes:
    try:
        result = subprocess.run(args, input=input_data, capture_output=True, check=False, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise DeployError(f"Migration rehearsal command failed: {Path(args[0]).name}") from exc
    if result.returncode:
        raise DeployError(f"Migration rehearsal command failed: {Path(args[0]).name} (exit {result.returncode})")
    return result.stdout


def _image_identity(image: str) -> dict[str, str]:
    if not IMAGE.fullmatch(image):
        raise DeployError("Images must be immutable OpenAthlete API SHA-256 digests")
    try:
        labels = json.loads(_run(["docker", "image", "inspect", image, "--format", "{{json .Config.Labels}}"])) or {}
    except json.JSONDecodeError as exc:
        raise DeployError("Could not read API image identity labels") from exc
    revision = labels.get("org.opencontainers.image.revision", "")
    version = labels.get("org.opencontainers.image.version", "")
    if labels.get("org.opencontainers.image.source") != REPOSITORY_URL or not REVISION.fullmatch(revision):
        raise DeployError("API image source or revision label is invalid")
    try:
        parse_version(version)
    except DeployError as exc:
        raise DeployError("API image version label is invalid") from exc
    try:
        tree = _run(["git", "rev-parse", f"{revision}:libs/database/prisma/schema/migrations"]).decode().strip()
    except DeployError as exc:
        raise DeployError("Image revision is not available locally; fetch its commit before rehearsal") from exc
    if not REVISION.fullmatch(tree):
        raise DeployError("Image migration tree identity is invalid")
    return {"image": image, "revision": revision, "version": version, "migrationTree": tree}


def _sql(container: str, sql: str) -> str:
    return _run(["docker", "exec", container, "psql", "-XAt", "-v", "ON_ERROR_STOP=1", "-U", "oa", "-d", "oa", "-c", sql]).decode().strip()


def _migrate(image: str, network: str, database: str) -> None:
    _run(["docker", "run", "--rm", "--network", network, "--workdir", "/app/libs/database",
          "--env", "DATABASE_URL=postgresql://oa:rehearsal-only@" + database + ":5432/oa?schema=public",
          "--entrypoint", "prisma", image, "migrate", "deploy"], timeout=600)


def _start_database(name: str, network: str, alias: str, created: list[str]) -> None:
    _run(["docker", "run", "--detach", "--name", name, "--network", network, "--network-alias", alias,
          "--env", "POSTGRES_USER=oa", "--env", "POSTGRES_PASSWORD=rehearsal-only", "--env", "POSTGRES_DB=oa",
          "--health-cmd", "pg_isready -U oa -d oa", "--health-interval", "2s", "--health-retries", "30",
          POSTGRES_IMAGE])
    created.append(name)
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        health = _run(["docker", "inspect", "--format", "{{.State.Health.Status}}", name]).decode().strip()
        if health == "healthy":
            return
        time.sleep(1)
    raise DeployError("Disposable PostgreSQL did not become healthy")


def _migration_count(container: str) -> int:
    value = _sql(container, 'SELECT count(*) FROM "_prisma_migrations" WHERE rolled_back_at IS NULL;')
    if not value.isdecimal():
        raise DeployError("Could not verify the applied migration state")
    return int(value)


def rehearse(base_image: str, candidate_image: str, output: Path | None = None) -> dict[str, Any]:
    for image in (base_image, candidate_image):
        if not IMAGE.fullmatch(image):
            raise DeployError("Images must be immutable OpenAthlete API SHA-256 digests")
    suffix = uuid.uuid4().hex[:12]
    network = f"oa-migration-rehearsal-{suffix}"
    base_db = f"oa-migration-rehearsal-base-{suffix}"
    restored_db = f"oa-migration-rehearsal-restore-{suffix}"
    created_network = False
    created_containers: list[str] = []
    receipt: dict[str, Any] = {
        "schemaVersion": 1,
        "result": "failed",
        "databaseImage": POSTGRES_IMAGE,
        "fixture": FIXTURE,
        "base": {"image": base_image},
        "candidate": {"image": candidate_image},
        "steps": {},
        "limitations": "Synthetic fixture only; this does not prove compatibility with production data or approve a migration tree.",
    }
    failure: Exception | None = None
    try:
        _run(["docker", "pull", base_image], timeout=600)
        _run(["docker", "pull", candidate_image], timeout=600)
        base = _image_identity(base_image)
        candidate = _image_identity(candidate_image)
        receipt["base"] = base
        receipt["candidate"] = candidate
        receipt["migrationTreeChanged"] = base["migrationTree"] != candidate["migrationTree"]
        if base_image == candidate_image:
            if base != candidate:
                raise DeployError("Identical image digests produced conflicting identities")
            receipt["positiveControlOnly"] = True
        elif base["revision"] == candidate["revision"] or parse_version(candidate["version"]) <= parse_version(base["version"]):
            raise DeployError("Candidate image must come from a later stable revision and version")
        _run(["docker", "network", "create", "--internal", network])
        created_network = True
        _start_database(base_db, network, "baseline-db", created_containers)
        _migrate(base_image, network, "baseline-db")
        receipt["steps"]["baseMigrations"] = True
        _sql(base_db, "CREATE TABLE workflow_migration_rehearsal (id integer PRIMARY KEY, marker text NOT NULL);")
        _sql(base_db, f"INSERT INTO workflow_migration_rehearsal VALUES (1, '{FIXTURE}');")
        receipt["steps"]["syntheticFixture"] = True
        with tempfile.TemporaryDirectory(prefix="oa-migration-rehearsal-") as temp:
            backup = Path(temp) / "synthetic.dump"
            dump = _run(["docker", "exec", base_db, "pg_dump", "-U", "oa", "-d", "oa", "--format=custom"], timeout=600)
            if not dump:
                raise DeployError("Synthetic database backup is empty")
            backup.write_bytes(dump)
            receipt["backupSha256"] = hashlib.sha256(dump).hexdigest()
            receipt["steps"]["syntheticBackup"] = True
            _migrate(candidate_image, network, "baseline-db")
            receipt["candidateMigrationCount"] = _migration_count(base_db)
            if _sql(base_db, "SELECT marker FROM workflow_migration_rehearsal WHERE id = 1;") != FIXTURE:
                raise DeployError("Synthetic fixture did not survive candidate migrations")
            receipt["steps"]["upgradePreservedFixture"] = True
            _start_database(restored_db, network, "restore-db", created_containers)
            _run(["docker", "exec", "-i", restored_db, "pg_restore", "-U", "oa", "-d", "postgres",
                  "--clean", "--if-exists", "--create", "--exit-on-error"], input_data=backup.read_bytes(), timeout=600)
            if _sql(restored_db, "SELECT marker FROM workflow_migration_rehearsal WHERE id = 1;") != FIXTURE:
                raise DeployError("Restored synthetic backup does not contain its fixture")
            receipt["steps"]["restorePreservedFixture"] = True
            baseline_count = _migration_count(restored_db)
            migration_delta = receipt["candidateMigrationCount"] - baseline_count
            if receipt["migrationTreeChanged"] and migration_delta <= 0:
                raise DeployError("Candidate migration rehearsal did not advance the migration state")
            if not receipt["migrationTreeChanged"] and migration_delta != 0:
                raise DeployError("Migration state changed without a migration-tree change")
            receipt["restoredMigrationCount"] = baseline_count
            receipt["steps"]["restoreRecoveredBaseline"] = True
            _migrate(candidate_image, network, "restore-db")
            if _migration_count(restored_db) != receipt["candidateMigrationCount"]:
                raise DeployError("Restored database did not reach the candidate migration state")
            if _sql(restored_db, "SELECT marker FROM workflow_migration_rehearsal WHERE id = 1;") != FIXTURE:
                raise DeployError("Synthetic fixture did not survive migration after restore")
            receipt["steps"]["restoredUpgradeVerified"] = True
        receipt["result"] = "passed"
    except Exception as exc:  # Preserve a machine-readable failure without dumping commands or data.
        failure = exc
        receipt["error"] = str(exc) if isinstance(exc, DeployError) else "Unexpected rehearsal failure"
    finally:
        cleanup_errors = []
        for name in reversed(created_containers):
            try:
                _run(["docker", "rm", "--force", name], timeout=60)
            except DeployError:
                cleanup_errors.append("container")
        if created_network:
            try:
                _run(["docker", "network", "rm", network], timeout=60)
            except DeployError:
                cleanup_errors.append("network")
        if cleanup_errors:
            receipt["result"] = "failed"
            receipt["cleanup"] = "owned temporary resources could not all be removed"
            failure = DeployError("Migration rehearsal cleanup did not complete")
        if output:
            output.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    if failure:
        raise DeployError(str(failure))
    return receipt


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-api-image", "--base-image", dest="base_api_image")
    parser.add_argument("--candidate-api-image", "--candidate-image", dest="candidate_api_image")
    parser.add_argument("--baseline-for")
    parser.add_argument("--github-output", type=Path)
    parser.add_argument("--json-output", type=Path)
    args = parser.parse_args()
    try:
        if args.baseline_for:
            if not args.github_output or args.base_api_image or args.candidate_api_image:
                parser.error("--baseline-for requires --github-output and no image arguments")
            result = baseline_for(args.baseline_for)
            with args.github_output.open("a", encoding="utf-8") as output:
                for key, value in result.items():
                    print(f"{key}={value}", file=output)
            return 0
        if not args.base_api_image or not args.candidate_api_image:
            parser.error("Both immutable API images are required")
        result = rehearse(args.base_api_image, args.candidate_api_image, args.json_output)
    except DeployError as exc:
        print(f"Migration rehearsal failed: {exc}")
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
