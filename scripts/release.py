"""Small helpers used by the Tourmalet release workflow."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "deploy"))
from artifacts import image_digest, image_refs, names, validate_v2

REPOSITORY = "https://github.com/GustaTheCreator/openathlete"
IMAGE_PREFIX = "ghcr.io/gustathecreator/openathlete"
SEMVER = re.compile(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")


def validate_candidate(candidate: dict, version: str, revision: str) -> dict:
    """Only accept the tested stable run's exact version, revision and digests."""
    if not SEMVER.fullmatch(version) or not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("Invalid candidate identity")
    if candidate.get("version") != version or candidate.get("revision") != revision:
        raise ValueError("Candidate does not match the release version and revision")
    if candidate.get("schemaVersion") == 2:
        if set(candidate) != {"schemaVersion", "version", "revision", "images", "components"}:
            raise ValueError("Candidate fields differ from the component schema")
        return validate_v2(candidate)
    for component in ("api", "web"):
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", candidate.get(component, "")):
            raise ValueError("Invalid candidate image digest")
    return candidate


def validate_release(
    version: str, tag: str, revision: str, main_ref: str = "origin/tourmalet"
) -> None:
    """Reject malformed, lightweight, mismatched, or unmerged releases."""
    if not SEMVER.fullmatch(version) or tag != f"tourmalet-v{version}":
        raise ValueError("Release tag must be tourmalet-v<SemVer> and match VERSION")
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("Release revision must be a full Git commit SHA")
    tag_ref = f"refs/tags/{tag}"
    tag_type = subprocess.run(
        ["git", "cat-file", "-t", tag_ref],
        check=False,
        capture_output=True,
        text=True,
    )
    if tag_type.returncode != 0 or tag_type.stdout.strip() != "tag":
        raise ValueError(f"Release tag {tag} must be an annotated Git tag")
    tag_revision = subprocess.run(
        ["git", "rev-parse", f"{tag_ref}^{{}}"],
        check=False,
        capture_output=True,
        text=True,
    )
    if tag_revision.returncode != 0 or tag_revision.stdout.strip() != revision:
        raise ValueError(f"Annotated release tag {tag} must point to the tested revision")
    result = subprocess.run(
        ["git", "merge-base", "--is-ancestor", revision, main_ref],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise ValueError(f"Release commit {revision} is not reachable from {main_ref}")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def create_source_archive(tag: str, revision: str, output_dir: Path) -> tuple[Path, str]:
    if not re.fullmatch(r"tourmalet-v" + SEMVER.pattern.removesuffix("\\Z") + r"", tag):
        raise ValueError("Invalid Tourmalet release tag")
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("Revision must be a full Git commit SHA")
    output_dir.mkdir(parents=True, exist_ok=True)
    archive = output_dir / f"openathlete-{tag}.tar.gz"
    subprocess.run(
        ["git", "archive", "--format=tar.gz", "--output", str(archive), revision],
        check=True,
    )
    return archive, sha256_file(archive)


def build_manifest(
    version: str,
    tag: str,
    revision: str,
    migration_tree: str,
    api_digest: str,
    web_digest: str,
    source_sha256: str,
) -> dict:
    if not SEMVER.fullmatch(version) or tag != f"tourmalet-v{version}":
        raise ValueError("Release tag must match VERSION")
    if not re.fullmatch(r"[0-9a-f]{40}", revision) or not re.fullmatch(
        r"[0-9a-f]{40}", migration_tree
    ):
        raise ValueError("Revision and migration tree must be full Git object IDs")
    for digest in (api_digest, web_digest, source_sha256):
        if not SHA256.fullmatch(digest):
            raise ValueError("Image and source digests must be lowercase SHA-256 values")
    return {
        "schemaVersion": 1,
        "version": version,
        "tag": tag,
        "revision": revision,
        "migrationTree": migration_tree,
        "images": {
            "api": f"{IMAGE_PREFIX}-api@sha256:{api_digest}",
            "web": f"{IMAGE_PREFIX}-web@sha256:{web_digest}",
        },
        "source": {
            "url": f"{REPOSITORY}/releases/download/{tag}/openathlete-{tag}.tar.gz",
            "sha256": source_sha256,
        },
    }


def build_component_manifest(candidate, tag, migration_tree, source_sha256):
    candidate = validate_candidate(candidate, candidate["version"], candidate["revision"])
    if tag != f"tourmalet-v{candidate['version']}" or not re.fullmatch(r"[a-f0-9]{40}", migration_tree):
        raise ValueError("Invalid component release tag or migration tree")
    if not SHA256.fullmatch(source_sha256):
        raise ValueError("Invalid source archive checksum")
    return {**candidate, "tag": tag, "migrationTree": migration_tree,
            "source": {"url": f"{REPOSITORY}/releases/download/{tag}/openathlete-{tag}.tar.gz", "sha256": source_sha256}}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    check = commands.add_parser(
        "check", help="Validate annotated tag, VERSION and stable Tourmalet branch ancestry"
    )
    check.add_argument("--tag", required=True)
    check.add_argument("--revision", required=True)
    check.add_argument(
        "--main-ref",
        default="origin/tourmalet",
        help="stable branch to check ancestry against (default: origin/tourmalet)",
    )
    check.add_argument("--version-file", type=Path, default=Path("VERSION"))

    candidate = commands.add_parser("candidate", help="Validate tested CI image metadata")
    candidate.add_argument("--input", type=Path, required=True)
    candidate.add_argument("--revision", required=True)
    candidate.add_argument("--version-file", type=Path, default=Path("VERSION"))

    source = commands.add_parser("source", help="Create the source archive and checksum")
    source.add_argument("--tag", required=True)
    source.add_argument("--revision", required=True)
    source.add_argument("--output-dir", type=Path, required=True)

    manifest = commands.add_parser("manifest", help="Write the release manifest")
    manifest.add_argument("--version-file", type=Path, default=Path("VERSION"))
    manifest.add_argument("--tag", required=True)
    manifest.add_argument("--revision", required=True)
    manifest.add_argument("--migration-tree", required=True)
    manifest.add_argument("--api-digest")
    manifest.add_argument("--web-digest")
    manifest.add_argument("--candidate", type=Path)
    manifest.add_argument("--source-sha256", required=True)
    manifest.add_argument("--output", type=Path, required=True)

    args = parser.parse_args()
    if args.command == "check":
        version = args.version_file.read_text(encoding="utf-8").strip()
        validate_release(version, args.tag, args.revision, args.main_ref)
    elif args.command == "candidate":
        candidate = validate_candidate(
            json.loads(args.input.read_text(encoding="utf-8")),
            args.version_file.read_text(encoding="utf-8").strip(), args.revision,
        )
        if candidate.get("schemaVersion") == 2:
            from components import verify_provenance
            verify_provenance(candidate)
        for component in names(candidate):
            print(f"{component}-digest={image_digest(candidate, component)}")
    elif args.command == "source":
        archive, digest = create_source_archive(args.tag, args.revision, args.output_dir)
        print(f"{archive}\n{digest}")
    else:
        version = args.version_file.read_text(encoding="utf-8").strip()
        if args.candidate:
            candidate = validate_candidate(json.loads(args.candidate.read_text()), version, args.revision)
            if candidate.get("schemaVersion") != 2 or args.api_digest or args.web_digest:
                raise ValueError("Component manifest requires exactly one version-2 candidate")
            manifest = build_component_manifest(candidate, args.tag, args.migration_tree, args.source_sha256)
        else:
            manifest = build_manifest(version, args.tag, args.revision, args.migration_tree,
                                      args.api_digest, args.web_digest, args.source_sha256)
        args.output.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
