"""Plan and safely apply retention for OpenAthlete recovery artifacts."""
from __future__ import annotations

import hashlib

import re
import subprocess
from pathlib import Path
from typing import Any, Callable

from artifacts import DeployError

BACKUP = re.compile(r"^database-([0-9]+)\.dump$")
SOURCE = re.compile(r"^openathlete-tourmalet-v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\.tar\.gz$")
IMAGE = re.compile(r"^(ghcr\.io/gustathecreator/openathlete-(?:api|web|migrator))@sha256:[a-f0-9]{64}$")


def _inside(path: Path, directory: Path) -> bool:
    try:
        path.resolve(strict=True).relative_to(directory.resolve(strict=True))
        return True
    except (OSError, ValueError):
        return False


def _linked(path: Path) -> bool:
    return path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction())


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _receipt_paths(receipt: Any) -> set[str]:
    found: set[str] = set()
    if isinstance(receipt, dict):
        backup = receipt.get("backup")
        if isinstance(backup, str):
            found.add(backup)
        source = receipt.get("source")
        if isinstance(source, dict) and isinstance(source.get("path"), str):
            found.add(source["path"])
        for value in (receipt.get("sourceArchive"), receipt.get("sourcePath")):
            if isinstance(value, str):
                found.add(value)
        found.update(_receipt_paths(receipt.get("current")))
    return found


def _receipt_images(receipt: Any) -> set[str]:
    images: set[str] = set()
    if not isinstance(receipt, dict):
        return images
    raw = receipt.get("images")
    if isinstance(raw, dict):
        images.update(value for value in raw.values() if isinstance(value, str))
    images.update(_receipt_images(receipt.get("current")))
    return images


def plan_retention(root: Path, state: Path, current: dict[str, Any] | None,
                   previous: dict[str, Any] | None, *, pins: tuple[str, ...] | list[str] = (),
                   keep: int = 5, image_references: tuple[Any, ...] | list[Any] = (),
                   image_ids: dict[str, str] | None = None,
                   container_image_ids: tuple[str, ...] | list[str] = ()) -> dict[str, Any]:
    """Return deletion candidates; callers must pass all local image refs and container IDs."""
    if keep < 1:
        raise DeployError("Retention must keep at least one artifact")
    root, state = Path(root), Path(state)
    backup_dir, source_dir = state / "backups", root / "public-source"
    protected_paths = _receipt_paths(current) | _receipt_paths(previous)
    protected_paths.update(str(Path(value)) for value in pins)
    pinned_names = {Path(value).name for value in pins}
    entries: list[dict[str, str]] = []
    preserved: list[dict[str, str]] = []
    groups = ((backup_dir, BACKUP, "backup"), (source_dir, SOURCE, "source"))
    for directory, pattern, kind in groups:
        if _linked(root) or _linked(state) or _linked(directory.parent) or _linked(directory):
            continue
        try:
            candidates = sorted(directory.iterdir(), key=lambda path: path.name, reverse=True)
        except OSError:
            continue
        allowed: list[Path] = []
        for path in candidates:
            if not pattern.fullmatch(path.name) or path.is_symlink() or not path.is_file() or not _inside(path, directory):
                continue
            if kind == "source" and path.name == "openathlete.tar.gz":
                preserved.append({"name": path.name, "reason": "stable-source"})
                continue
            allowed.append(path)
        def sequence(path: Path) -> tuple[Any, ...]:
            if kind == "backup":
                return (int(BACKUP.fullmatch(path.name).group(1)), path.name)
            version = re.fullmatch(r"openathlete-tourmalet-v([0-9]+)\.([0-9]+)\.([0-9]+)(?:-(.*))?\.tar\.gz", path.name)
            return (tuple(int(part) for part in version.group(1, 2, 3)), version.group(4) or "~", path.name)
        allowed.sort(key=sequence, reverse=True)
        latest = {path.name for path in allowed[:keep]}
        for path in allowed:
            resolved = str(path.resolve(strict=True))
            if resolved in protected_paths or str(path) in protected_paths or path.name in pinned_names:
                preserved.append({"name": path.name, "reason": "pinned"})
            elif path.name in latest:
                preserved.append({"name": path.name, "reason": "latest"})
            else:
                entries.append({"path": resolved, "name": path.name, "kind": kind, "sha256": _sha256(path)})

    ids = image_ids or {}
    records: list[dict[str, Any]] = []
    for value in image_references:
        if isinstance(value, str):
            records.append({"reference": value, "id": ids.get(value), "repoTags": []})
        elif isinstance(value, dict):
            records.append(value)
    protected_images = _receipt_images(current) | _receipt_images(previous)
    protected_images.update(value for value in pins if IMAGE.fullmatch(value))
    container_ids = set(container_image_ids)
    eligible_images: list[str] = []
    protected_image_entries: list[dict[str, str]] = []
    valid_images: list[tuple[str, str, str]] = []
    for record in records:
        reference, image_id = record.get("reference"), record.get("id")
        if (not isinstance(reference, str) or not isinstance(image_id, str) or not IMAGE.fullmatch(reference)
                or record.get("repoTags", []) not in ([], ["<none>:<none>"])
                or not re.fullmatch(r"sha256:[a-f0-9]{64}", image_id)):
            continue
        valid_images.append((str(record.get("created", "")), reference, image_id))
    ref_counts: dict[str, int] = {}
    id_counts: dict[str, int] = {}
    for _created, reference, image_id in valid_images:
        ref_counts[reference] = ref_counts.get(reference, 0) + 1
        id_counts[image_id] = id_counts.get(image_id, 0) + 1
    valid_images = [(created, reference, image_id) for created, reference, image_id in valid_images
                    if ref_counts[reference] == 1 and id_counts[image_id] == 1]
    latest_images: dict[str, set[str]] = {}
    for _created, reference, _image_id in sorted(valid_images, reverse=True):
        repo = IMAGE.fullmatch(reference).group(1)
        latest_images.setdefault(repo, set())
        if len(latest_images[repo]) < keep:
            latest_images[repo].add(reference)
    for _created, reference, image_id in valid_images:
        repo = IMAGE.fullmatch(reference).group(1)
        if reference in protected_images or image_id in container_ids or reference in latest_images[repo]:
            protected_image_entries.append({"reference": reference, "reason": "pinned-or-in-use"})
        else:
            eligible_images.append(reference)
    current_backup = (current or {}).get("backup")
    current_source_sha256 = (current or {}).get("backupSourceSha256")
    current_backup_hash = None
    if isinstance(current_backup, str):
        backup_path = Path(current_backup)
        if (BACKUP.fullmatch(backup_path.name) and _inside(backup_path, backup_dir)
                and not _linked(backup_path) and not _linked(backup_dir.parent) and not _linked(backup_dir)):
            current_backup_hash = _sha256(backup_path)
    return {"files": entries, "images": eligible_images,
            "preserved": preserved, "preservedImages": protected_image_entries,
            "backupSha256": current_backup_hash,
            "sourceSha256": current_source_sha256,
            "directories": {"backup": str(backup_dir.resolve()) if backup_dir.exists() else str(backup_dir.absolute()),
                            "source": str(source_dir.resolve()) if source_dir.exists() else str(source_dir.absolute())}}


def _docker(args: list[str]) -> bytes:
    try:
        result = subprocess.run(args, capture_output=True, check=False, timeout=120)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise DeployError("Retention Docker command failed") from exc
    if result.returncode:
        raise DeployError("Retention Docker command failed")
    return result.stdout


def apply_retention(plan: dict[str, Any], restore_receipt: dict[str, Any] | None, migration_tree: str,
                    *, apply: bool = False, docker_runner: Callable[[list[str]], bytes] | None = None) -> dict[str, Any]:
    """Dry-run by default; deletion requires a successful restore bound to a planned backup and tree."""
    result = {"dryRun": not apply, "deleted": [], "errors": []}
    if not apply:
        return result
    receipt = restore_receipt or {}
    backup_hash = plan.get("backupSha256")
    source_hash = plan.get("sourceSha256")
    if (receipt.get("result") != "passed" or not backup_hash or receipt.get("backupSha256") != backup_hash
            or not isinstance(source_hash, str) or not re.fullmatch(r"[a-f0-9]{64}", source_hash)
            or receipt.get("sourceSha256") != source_hash
            or receipt.get("migrationTree") != migration_tree or not re.fullmatch(r"[a-f0-9]{40}", migration_tree)):
        raise DeployError("A verified restore receipt for the planned backup, source archive and current migration tree is required")
    for item in plan.get("files", []):
        path = Path(item["path"])
        try:
            kind = item.get("kind")
            pattern = BACKUP if kind == "backup" else SOURCE if kind == "source" else None
            expected = Path(plan.get("directories", {}).get(kind, ""))
            if (pattern is None or not pattern.fullmatch(path.name) or _linked(expected)
                    or _linked(path.parent) or _linked(path) or not path.is_file() or not _inside(path, expected)
                    or _sha256(path) != item["sha256"]):
                raise DeployError("Artifact changed after retention planning")
            if path.parent.resolve(strict=True) != expected.resolve(strict=True):
                raise DeployError("Artifact path is outside retention directory")
            path.unlink()
            result["deleted"].append(item["name"])
        except (OSError, DeployError):
            result["errors"].append(item.get("name", "artifact"))
    run = docker_runner or _docker
    for reference in plan.get("images", []):
        if not IMAGE.fullmatch(reference):
            result["errors"].append("image")
            continue
        try:
            run(["docker", "image", "rm", reference])
            result["deleted"].append(reference)
        except Exception:
            result["errors"].append(reference)
    return result
