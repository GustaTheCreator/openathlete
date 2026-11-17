"""Verify a local PostgreSQL dump in an isolated disposable container."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import tarfile
import uuid
from pathlib import Path, PurePosixPath
from typing import Callable

from artifacts import DeployError

POSTGRES_IMAGE = "pgvector/pgvector:pg17"


def _docker(args: list[str], input_stream: object | None = None, timeout: int = 600) -> bytes:
    try:
        result = subprocess.run(args, stdin=input_stream, capture_output=True, check=False, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise DeployError("Restore check Docker command failed") from exc
    if result.returncode:
        raise DeployError("Restore check Docker command failed")
    return result.stdout


def _git_oid(kind: bytes, data: bytes) -> bytes:
    return hashlib.sha1(kind + b" " + str(len(data)).encode() + b"\0" + data).digest()


def _source_migrations(archive: Path, expected_sha256: str, migration_tree: str) -> dict[str, str]:
    if not re.fullmatch(r"[a-f0-9]{64}", expected_sha256):
        raise DeployError("A full source archive SHA-256 is required")
    digest = hashlib.sha256()
    with archive.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != expected_sha256:
        raise DeployError("Source archive SHA-256 does not match its recovery receipt")

    prefix = PurePosixPath("libs/database/prisma/schema/migrations")
    files: dict[str, tuple[int, bytes]] = {}
    try:
        with tarfile.open(archive, "r:gz") as bundle:
            for member in bundle.getmembers():
                path = PurePosixPath(member.name)
                if path.is_absolute() or ".." in path.parts:
                    raise DeployError("Source archive contains an unsafe path")
                try:
                    relative = path.relative_to(prefix)
                except ValueError:
                    continue
                if not relative.parts:
                    continue
                if member.isdir():
                    continue
                if not member.isfile() or relative.as_posix() in files:
                    raise DeployError("Migration source archive contains unsupported or duplicate files")
                content = bundle.extractfile(member)
                if content is None:
                    raise DeployError("Migration source archive file could not be read")
                mode = 0o100755 if member.mode & 0o111 else 0o100644
                files[relative.as_posix()] = (mode, content.read())
    except (OSError, tarfile.TarError) as exc:
        raise DeployError("Migration source archive could not be read") from exc

    if not files or "migration_lock.toml" not in files:
        raise DeployError("Source archive does not contain the Prisma migrations tree")

    def tree_oid(directory: str) -> bytes:
        base = f"{directory}/" if directory else ""
        children = {path[len(base):].split("/", 1)[0] for path in files if path.startswith(base)}
        entries: list[tuple[bytes, bytes]] = []
        for name in children:
            path = base + name
            descendants = any(candidate.startswith(path + "/") for candidate in files)
            if path in files and descendants:
                raise DeployError("Migration archive file conflicts with a directory")
            if path in files:
                mode, content = files[path]
                object_id = _git_oid(b"blob", content)
                sort_name = name.encode() + b"\0"
            else:
                mode = 0o40000
                object_id = tree_oid(path)
                sort_name = name.encode() + b"/"
            entries.append((sort_name, f"{mode:o} {name}".encode() + b"\0" + object_id))
        payload = b"".join(entry for _, entry in sorted(entries, key=lambda item: item[0]))
        return _git_oid(b"tree", payload)

    if tree_oid("").hex() != migration_tree:
        raise DeployError("Source archive migrations do not match the receipt migration tree")

    migration_sql: dict[str, str] = {}
    directories = {path.split("/", 1)[0] for path in files if "/" in path}
    for name in directories:
        sql = files.get(f"{name}/migration.sql")
        if sql is None:
            raise DeployError("Source archive contains a migration without migration.sql")
        if any(path.startswith(name + "/") and path != f"{name}/migration.sql" for path in files):
            raise DeployError("Source archive migration contains unexpected files")
        migration_sql[name] = hashlib.sha256(sql[1]).hexdigest()
    if not migration_sql:
        raise DeployError("Source archive contains no Prisma migrations")
    return migration_sql


def _verify_migration_rows(raw: bytes, expected: dict[str, str]) -> int:
    try:
        rows = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise DeployError("Restored migration history could not be read") from exc
    if not isinstance(rows, list) or len(rows) != len(expected):
        raise DeployError("Restored migration history does not match the source archive")
    actual: dict[str, str] = {}
    for row in rows:
        if (not isinstance(row, dict) or not isinstance(row.get("migration_name"), str)
                or not isinstance(row.get("checksum"), str) or row.get("finished") is not True
                or row.get("rolled_back") is not False or row["migration_name"] in actual):
            raise DeployError("Restored migration history is incomplete or ambiguous")
        actual[row["migration_name"]] = row["checksum"]
    if actual != expected:
        raise DeployError("Restored migration history does not match the source archive")
    return len(actual)


def verify_backup(path: Path, migration_tree: str, source_archive: Path, source_sha256: str,
                  docker_runner: Callable[..., bytes] | None = None) -> dict[str, str | int]:
    """Restore a caller-selected local dump without host mounts, ports or external networking."""
    path = Path(path)
    source_archive = Path(source_archive)
    if (not re.fullmatch(r"[a-f0-9]{40}", migration_tree) or path.is_symlink()
            or not path.is_file() or path.name in (".", "..") or source_archive.is_symlink()
            or not source_archive.is_file()):
        raise DeployError("A regular local backup, source archive and full migration tree are required")
    expected = _source_migrations(source_archive, source_sha256, migration_tree)
    backup_hash = hashlib.sha256()
    with path.open("rb") as backup:
        for chunk in iter(lambda: backup.read(1024 * 1024), b""):
            backup_hash.update(chunk)
    container = "oa-restore-check-" + uuid.uuid4().hex[:16]
    run = docker_runner or _docker
    created = False
    try:
        run(["docker", "run", "--detach", "--name", container, "--network", "none",
             "--env", "POSTGRES_USER=oa", "--env", "POSTGRES_PASSWORD=restore-check-only",
             "--env", "POSTGRES_DB=oa", "--health-cmd", "pg_isready -U oa -d oa",
             "--health-interval", "2s", "--health-retries", "30", POSTGRES_IMAGE])
        created = True
        import time
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            health = run(["docker", "inspect", "--format", "{{.State.Health.Status}}", container]).decode().strip()
            if health == "healthy":
                break
            time.sleep(1)
        else:
            raise DeployError("Disposable PostgreSQL did not become healthy")
        with path.open("rb") as backup:
            run(["docker", "exec", "-i", container, "pg_restore", "--exit-on-error", "--no-owner",
                 "--no-privileges", "-U", "oa", "-d", "oa"], input_stream=backup)
        migration = run(["docker", "exec", container, "psql", "-XAt", "-v", "ON_ERROR_STOP=1",
                         "-U", "oa", "-d", "oa", "-c",
                         'SELECT COALESCE(json_agg(json_build_object(\'migration_name\', migration_name, \'checksum\', checksum, \'finished\', finished_at IS NOT NULL, \'rolled_back\', rolled_back_at IS NOT NULL)), \'[]\'::json)::text FROM "_prisma_migrations";'])
        migration_count = _verify_migration_rows(migration, expected)
        return {"result": "passed", "backupSha256": backup_hash.hexdigest(),
                "sourceSha256": source_sha256,
                "migrationTree": migration_tree, "migrationCount": migration_count}
    finally:
        if created:
            try:
                run(["docker", "rm", "--force", "--volumes", container])
            except DeployError:
                raise DeployError("Could not remove disposable restore-check container")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backup", type=Path)
    parser.add_argument("--migration-tree", required=True)
    parser.add_argument("--source-archive", required=True, type=Path)
    parser.add_argument("--source-sha256", required=True)
    args = parser.parse_args()
    try:
        result = verify_backup(args.backup, args.migration_tree, args.source_archive, args.source_sha256)
    except DeployError as exc:
        print(f"Restore check failed: {exc}")
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
