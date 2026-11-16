#!/usr/bin/env python3
"""Pull and activate reviewed OpenAthlete releases on a single Compose host."""
from __future__ import annotations

import argparse
import contextlib
try:
    import fcntl
except ImportError:  # Windows is supported for local validation, not server deployment.
    fcntl = None
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

REPOSITORY = "GustaTheCreator/openathlete"
REPOSITORY_URL = "https://github.com/GustaTheCreator/openathlete"
MANIFEST_NAME = "tourmalet-release.json"
SOURCE_NAME = "openathlete-{tag}.tar.gz"
HEX40 = re.compile(r"^[a-f0-9]{40}$")
HEX64 = re.compile(r"^[a-f0-9]{64}$")
SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
API = "https://api.github.com"


class DeployError(RuntimeError):
    pass


def log(message: str) -> None:
    print(message, flush=True)


def _request(url: str, limit: int = 2_000_000) -> bytes:
    if not url.startswith("https://"):
        raise DeployError("Only HTTPS download URLs are allowed")
    req = urllib.request.Request(url, headers={"User-Agent": "OpenAthlete-Tourmalet-Deployer/1", "Accept": "application/vnd.github+json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            if response.status != 200:
                raise DeployError(f"HTTP request failed with status {response.status}")
            data = response.read(limit + 1)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise DeployError("Release download failed") from exc
    if len(data) > limit:
        raise DeployError("Downloaded data exceeds configured size limit")
    return data


def parse_version(value: str) -> tuple[int, int, int]:
    match = SEMVER.fullmatch(value)
    if not match:
        raise DeployError("Release version must be stable MAJOR.MINOR.PATCH SemVer")
    return tuple(int(part) for part in match.groups())


def validate_manifest(value: Any, tag: str, source_url: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {"schemaVersion", "version", "tag", "revision", "migrationTree", "images", "source"}:
        raise DeployError("Release manifest has unexpected or missing fields")
    if type(value["schemaVersion"]) is not int or value["schemaVersion"] != 1:
        raise DeployError("Unsupported release manifest schema")
    version = value["version"]
    parse_version(version)
    if value["tag"] != tag or tag != f"tourmalet-v{version}":
        raise DeployError("Manifest tag and stable version do not match the selected release")
    if not HEX40.fullmatch(str(value["revision"])) or not HEX40.fullmatch(str(value["migrationTree"])):
        raise DeployError("Manifest revision or migration tree is invalid")
    images = value["images"]
    if not isinstance(images, dict) or set(images) != {"api", "web"}:
        raise DeployError("Manifest must contain exactly API and web image digests")
    for service in ("api", "web"):
        expected = f"ghcr.io/gustathecreator/openathlete-{service}@sha256:"
        digest = images[service]
        if not isinstance(digest, str) or not digest.startswith(expected) or not HEX64.fullmatch(digest[len(expected):]):
            raise DeployError(f"Invalid {service} image digest")
    source = value["source"]
    expected_source_url = f"https://github.com/{REPOSITORY}/releases/download/{tag}/{SOURCE_NAME.format(tag=tag)}"
    if not isinstance(source, dict) or set(source) != {"url", "sha256"} or source["url"] != expected_source_url or source_url != expected_source_url:
        raise DeployError("Source archive URL does not match the selected repository release")
    if not isinstance(source["sha256"], str) or not HEX64.fullmatch(source["sha256"]):
        raise DeployError("Invalid source archive SHA-256")
    return value


def load_config(path: Path) -> dict[str, Any]:
    try:
        cfg = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise DeployError("Cannot read deployment configuration") from exc
    required = {"root", "repository", "composeFiles", "project", "postgresService", "allowedMigrationTrees", "healthTimeoutSeconds"}
    if not isinstance(cfg, dict) or set(cfg) != required:
        raise DeployError("Configuration fields do not match the supported schema")
    if cfg["repository"] != REPOSITORY:
        raise DeployError("Repository is fixed to the reviewed OpenAthlete fork")
    if cfg["postgresService"] != "postgres":
        raise DeployError("PostgreSQL service name is fixed to postgres")
    root = Path(cfg["root"])
    if not root.is_absolute() or not root.is_dir():
        raise DeployError("Configured root must be an existing absolute directory")
    files = cfg["composeFiles"]
    if not isinstance(files, list) or not files or any(not isinstance(x, str) or not (root / x).is_file() for x in files):
        raise DeployError("Every configured Compose file must exist under root")
    trees = cfg["allowedMigrationTrees"]
    if not isinstance(trees, list) or not trees or any(not isinstance(x, str) or not HEX40.fullmatch(x) for x in trees):
        raise DeployError("At least one approved 40-character migration tree hash is required")
    timeout = cfg["healthTimeoutSeconds"]
    if type(timeout) is not int or timeout < 15 or timeout > 600:
        raise DeployError("healthTimeoutSeconds must be between 15 and 600")
    if not isinstance(cfg["project"], str) or not re.fullmatch(r"[a-zA-Z0-9_-]+", cfg["project"]):
        raise DeployError("Invalid Compose project name")
    return cfg


def _github_release() -> tuple[str, dict[str, str]] | None:
    releases = json.loads(_request(f"{API}/repos/{REPOSITORY}/releases?per_page=20"))
    choices: list[tuple[tuple[int, int, int], str, dict[str, str]]] = []
    for release in releases:
        if release.get("draft") or release.get("prerelease"):
            continue
        tag = release.get("tag_name", "")
        match = re.fullmatch(r"tourmalet-v(\d+\.\d+\.\d+)", tag)
        if not match:
            continue
        try:
            version = parse_version(match.group(1))
        except DeployError:
            continue
        assets = {asset.get("name"): asset.get("browser_download_url") for asset in release.get("assets", [])}
        expected = f"https://github.com/{REPOSITORY}/releases/download/{tag}/{SOURCE_NAME.format(tag=tag)}"
        if assets.get(MANIFEST_NAME) == f"https://github.com/{REPOSITORY}/releases/download/{tag}/{MANIFEST_NAME}" and assets.get(SOURCE_NAME.format(tag=tag)) == expected:
            choices.append((version, tag, {"manifest": assets[MANIFEST_NAME], "source": expected}))
    if not choices:
        return None
    _, tag, urls = max(choices, key=lambda item: item[0])
    return tag, urls


def _run(args: list[str], *, capture: bool = True, check: bool = True, input_data: bytes | None = None,
         timeout: int = 120) -> bytes:
    try:
        result = subprocess.run(args, input=input_data, stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
                                stderr=subprocess.PIPE if capture else subprocess.DEVNULL, check=False, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise DeployError(f"Command failed to run: {Path(args[0]).name}") from exc
    if check and result.returncode:
        # docker stderr can contain rendered configuration; never echo it.
        raise DeployError(f"Command failed: {Path(args[0]).name} (exit {result.returncode})")
    return result.stdout or b""


def _compose(cfg: dict[str, Any], state: Path, *args: str) -> list[str]:
    command = ["docker", "compose"]
    for file in cfg["composeFiles"]:
        command += ["-f", str(Path(cfg["root"]) / file)]
    override = state / "release.json"
    if override.exists():
        command += ["-f", str(override)]
    command += ["--project-name", cfg["project"], *args]
    return command


def _image_metadata(image: str) -> dict[str, str]:
    raw = _run(["docker", "image", "inspect", image, "--format", "{{json .Config.Labels}}"])
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise DeployError("Could not inspect pulled image labels") from exc
    return data or {}


def _verify_images(manifest: dict[str, Any]) -> None:
    for service in ("api", "web"):
        labels = _image_metadata(manifest["images"][service])
        expected = {"org.opencontainers.image.revision": manifest["revision"],
                    "org.opencontainers.image.source": REPOSITORY_URL,
                    "org.opencontainers.image.version": manifest["version"]}
        if any(labels.get(key) != value for key, value in expected.items()):
            raise DeployError(f"Pulled {service} image labels do not match the release manifest")


def _containers(cfg: dict[str, Any], state: Path) -> dict[str, dict[str, str]]:
    ids = [line for line in _run(_compose(cfg, state, "ps", "-q")).decode().splitlines() if line]
    result: dict[str, dict[str, str]] = {}
    for ident in ids:
        info = json.loads(_run(["docker", "inspect", ident]))[0]
        labels = info.get("Config", {}).get("Labels") or {}
        service = labels.get("com.docker.compose.service")
        if service:
            result[service] = {"id": info.get("Id", ""), "image": info.get("Image", ""),
                               "startedAt": info.get("State", {}).get("StartedAt", "")}
    return result


def _snapshot(cfg: dict[str, Any], state: Path) -> dict[str, Any]:
    env = Path(cfg["root"]) / ".env"
    return {"override": (state / "release.json").read_text(encoding="utf-8") if (state / "release.json").exists() else None,
            "stableSourceSha256": _file_hash(Path(cfg["root"]) / "public-source" / "openathlete.tar.gz"),
            "containers": _containers(cfg, state), "envSha256": _file_hash(env) if env.exists() else None,
            "current": _read_state(state / "current.json")}


def _file_hash(path: Path) -> str | None:
    if not path.is_file():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_private(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix=".tmp-", dir=path.parent)
    try:
        os.fchmod(fd, 0o600) if hasattr(os, "fchmod") else os.chmod(temporary, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)


def _write_public(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
    fd, temporary = tempfile.mkstemp(prefix=".tmp-", dir=path.parent)
    try:
        os.fchmod(fd, 0o644) if hasattr(os, "fchmod") else os.chmod(temporary, 0o644)
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)


def _source_file(root: Path, tag: str) -> Path:
    return root / "public-source" / SOURCE_NAME.format(tag=tag)


def _make_override(root: Path, manifest: dict[str, Any]) -> bytes:
    source = _source_file(root, manifest["tag"])
    stable = root / "public-source" / "openathlete.tar.gz"
    # Compose JSON is valid YAML; replacing only these two services preserves
    # all values and mounts from every operator-maintained Compose file.
    obj = {"services": {
        "api": {"image": manifest["images"]["api"]},
        "web": {"image": manifest["images"]["web"], "volumes": [
            {"type": "bind", "source": str(stable), "target": "/usr/share/nginx/html/source/openathlete.tar.gz", "read_only": True, "bind": {"create_host_path": False}},
            {"type": "bind", "source": str(source), "target": f"/usr/share/nginx/html/source/{source.name}", "read_only": True, "bind": {"create_host_path": False}}
        ]}
    }}
    return (json.dumps(obj, sort_keys=True, indent=2) + "\n").encode()


def _check_release(cfg: dict[str, Any], state: Path) -> tuple[dict[str, Any] | None, str]:
    found = _github_release()
    if not found:
        return None, "No stable Tourmalet release is available."
    tag, urls = found
    manifest_data = json.loads(_request(urls["manifest"], 100_000))
    manifest = validate_manifest(manifest_data, tag, urls["source"])
    if manifest["migrationTree"] not in cfg["allowedMigrationTrees"]:
        raise DeployError("Migration tree is not in allowedMigrationTrees; no host or Compose changes were made")
    rejected = _read_state(state / "rejected.json") or {"releases": []}
    if any(item.get("version") == manifest["version"] for item in rejected.get("releases", [])):
        return None, f"Release {manifest['version']} was rejected and is blocked until a new patch release is published."
    current = _read_state(state / "current.json")
    candidate = parse_version(manifest["version"])
    if current:
        previous = parse_version(current["version"])
        if candidate < previous:
            raise DeployError("Downgrades are blocked")
        if candidate == previous and manifest["revision"] != current["revision"]:
            raise DeployError("A published version cannot be reused for a different source revision")
        if candidate == previous:
            if current.get("manifestFingerprint") != _manifest_fingerprint(manifest):
                raise DeployError("A published version cannot be reused for different image or source digests")
            return None, f"Already on {manifest['version']} ({manifest['revision'][:12]})."
    return manifest, f"Release {manifest['version']} is ready ({manifest['revision'][:12]})."


def _read_state(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def _manifest_fingerprint(manifest: dict[str, Any]) -> str:
    encoded = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def _reject_release(state: Path, version: str, revision: str, reason: str) -> None:
    rejected = _read_state(state / "rejected.json") or {"releases": []}
    entries = [item for item in rejected.get("releases", []) if item.get("version") != version]
    entries.append({"version": version, "revision": revision, "reason": reason, "rejectedAt": int(time.time())})
    _write_private(state / "rejected.json", (json.dumps({"releases": entries}, sort_keys=True) + "\n").encode())


def check(cfg: dict[str, Any], state: Path) -> int:
    manifest, message = _check_release(cfg, state)
    log(message)
    if manifest:
        log("The migration tree is approved; this check does not pull images or alter containers.")
    return 0


def _backup_database(cfg: dict[str, Any], state: Path) -> Path:
    container = _run(_compose(cfg, state, "ps", "-q", cfg["postgresService"])).decode().strip()
    if not container:
        raise DeployError("PostgreSQL Compose service is not running; refusing deployment")
    path = state / "backups" / f"database-{int(time.time())}.dump"
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    data = _run(["docker", "exec", container, "sh", "-c",
                 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom'])
    if not data:
        raise DeployError("PostgreSQL backup is empty; refusing deployment")
    _write_private(path, data)
    return path


def _wait_health(cfg: dict[str, Any], state: Path) -> None:
    deadline = time.monotonic() + cfg["healthTimeoutSeconds"]
    pending = {"api", "web"}
    while time.monotonic() < deadline:
        containers = _containers(cfg, state)
        for name in tuple(pending):
            container = containers.get(name)
            if not container:
                continue
            raw = json.loads(_run(["docker", "inspect", container["id"]]))[0]
            status = raw.get("State", {}).get("Status")
            health = raw.get("State", {}).get("Health", {}).get("Status")
            if status == "running" and health == "healthy":
                pending.remove(name)
            elif status == "running" and name == "api" and not health:
                # The API image has no Docker healthcheck; use its documented endpoint.
                try:
                    probe = subprocess.run(["docker", "exec", container["id"], "node", "-e",
                                            "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],
                                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
                    if probe.returncode == 0:
                        pending.remove(name)
                except (OSError, subprocess.TimeoutExpired):
                    pass
        if not pending:
            return
        time.sleep(2)
    raise DeployError("Application services did not become healthy before timeout")


def _atomic_copy(source: Path, dest: Path, *, public: bool = False) -> None:
    data = source.read_bytes()
    (_write_public if public else _write_private)(dest, data)


def _verify_archive(archive: bytes, expected_sha256: str) -> None:
    if hashlib.sha256(archive).hexdigest() != expected_sha256:
        raise DeployError("Source archive SHA-256 mismatch; production was not changed")


def _restore(cfg: dict[str, Any], state: Path, snapshot: dict[str, Any]) -> None:
    override = state / "release.json"
    if snapshot["override"] is None:
        with contextlib.suppress(FileNotFoundError):
            override.unlink()
    else:
        _write_private(override, snapshot["override"].encode())
    if snapshot.get("stableSourceBackup"):
        backup = Path(snapshot["stableSourceBackup"])
        stable = Path(cfg["root"]) / "public-source" / "openathlete.tar.gz"
        _atomic_copy(backup, stable, public=True)
        if _file_hash(stable) != snapshot.get("stableSourceSha256"):
            raise DeployError("Restored public source archive did not match the saved snapshot")
    elif snapshot.get("stableSourceSha256") is None:
        with contextlib.suppress(FileNotFoundError):
            (Path(cfg["root"]) / "public-source" / "openathlete.tar.gz").unlink()
    _run(_compose(cfg, state, "up", "-d", "--no-deps", "--no-build", "--pull", "never", "api", "web"))
    _wait_health(cfg, state)
    if snapshot.get("current") is None:
        with contextlib.suppress(FileNotFoundError):
            (state / "current.json").unlink()
    else:
        _write_private(state / "current.json", (json.dumps(snapshot["current"], sort_keys=True) + "\n").encode())


def deploy(cfg: dict[str, Any], state: Path) -> int:
    manifest, message = _check_release(cfg, state)
    if not manifest:
        log(message)
        return 0
    log(message)
    # All trust and migration gates above run before pull, backup, or container changes.
    for digest in manifest["images"].values():
        _run(["docker", "pull", digest], timeout=600)
    _verify_images(manifest)
    archive = _request(manifest["source"]["url"], 100_000_000)
    _verify_archive(archive, manifest["source"]["sha256"])

    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(state, 0o700)
    snapshot = _snapshot(cfg, state)
    backup = _backup_database(cfg, state)
    root = Path(cfg["root"])
    source_path = _source_file(root, manifest["tag"])
    source_path.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    activation_started = False
    try:
        _write_public(source_path, archive)
        stable_path = root / "public-source" / "openathlete.tar.gz"
        if stable_path.exists():
            old_backup = state / "previous-source.tar.gz"
            _atomic_copy(stable_path, old_backup)
            snapshot["stableSourceBackup"] = str(old_backup)
        else:
            snapshot["stableSourceBackup"] = None
        _write_public(stable_path, archive)
        _write_private(state / "release.json", _make_override(root, manifest))
        _write_private(state / "previous.json", (json.dumps(snapshot, sort_keys=True) + "\n").encode())
        activation_started = True
        _run(_compose(cfg, state, "up", "-d", "--no-deps", "--no-build", "--pull", "never", "api", "web"))
        _wait_health(cfg, state)
        after = _snapshot(cfg, state)
        if after["envSha256"] != snapshot["envSha256"]:
            raise DeployError("Private environment file changed during deployment")
        before_other = {name: item for name, item in snapshot["containers"].items() if name not in {"api", "web"}}
        after_other = {name: item for name, item in after["containers"].items() if name not in {"api", "web"}}
        if before_other != after_other:
            raise DeployError("An unrelated Compose service changed during deployment")
        current = {"version": manifest["version"], "revision": manifest["revision"], "migrationTree": manifest["migrationTree"],
                   "tag": manifest["tag"], "images": manifest["images"], "sourceSha256": manifest["source"]["sha256"],
                   "manifestFingerprint": _manifest_fingerprint(manifest), "backup": str(backup), "deployedAt": int(time.time())}
        _write_private(state / "current.json", (json.dumps(current, sort_keys=True) + "\n").encode())
    except Exception:
        rejection_failure = None
        if activation_started:
            try:
                _reject_release(state, manifest["version"], manifest["revision"], "activation_failed")
            except Exception as exc:
                rejection_failure = exc
        try:
            _restore(cfg, state, snapshot)
        except Exception as restore_failure:
            raise DeployError("Deployment failed and application rollback could not be verified") from restore_failure
        if rejection_failure:
            raise DeployError("Deployment was rolled back, but the failed-release retry guard could not be saved") from rejection_failure
        raise
    log(f"Deployed {manifest['version']} ({manifest['revision'][:12]}); database backup: {backup.name}.")
    return 0


def rollback(cfg: dict[str, Any], state: Path) -> int:
    snapshot = _read_state(state / "previous.json")
    if not snapshot:
        raise DeployError("No saved application rollback snapshot exists")
    current = _read_state(state / "current.json")
    rejection_failure = None
    if current:
        try:
            _reject_release(state, current["version"], current["revision"], "manual_rollback")
        except Exception as exc:
            rejection_failure = exc
    try:
        _restore(cfg, state, snapshot)
    except Exception as restore_failure:
        raise DeployError("Manual rollback failed and could not be verified") from restore_failure
    if rejection_failure:
        raise DeployError("Rollback completed, but the automatic reapply guard could not be saved") from rejection_failure
    log("Previous application images and Compose override restored; database was left untouched.")
    return 0


def status(state: Path) -> int:
    current = _read_state(state / "current.json")
    if not current:
        log("No automated release has been deployed yet.")
    else:
        log(f"Version: {current.get('version')}\nRevision: {current.get('revision')}\nTag: {current.get('tag')}\n"
            f"Images: {json.dumps(current.get('images', {}), sort_keys=True)}\n"
            f"Source SHA-256: {current.get('sourceSha256')}\nDeployed: {current.get('deployedAt')}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("command", choices=("check", "deploy", "status", "rollback"))
    args = parser.parse_args(argv)
    try:
        cfg = load_config(args.config)
        state = Path(cfg["root"]) / ".deploy"
        state.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(state, 0o700)
        lock_path = state / "lock"
        with lock_path.open("a+b") as lock:
            os.chmod(lock_path, 0o600)
            if fcntl is not None:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if args.command == "check":
                return check(cfg, state)
            if args.command == "deploy":
                return deploy(cfg, state)
            if args.command == "rollback":
                return rollback(cfg, state)
            return status(state)
    except BlockingIOError:
        log("Another deployment command is already running.")
        return 2
    except DeployError as exc:
        log(f"Deployment stopped: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
