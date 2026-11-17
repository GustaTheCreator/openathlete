"""Build or reuse components only when their complete Git build inputs match."""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "deploy"))
from artifacts import COMPONENTS, IMAGE_PREFIX, REPOSITORY_URL, SEMVER, SHA, expected_labels, repository, validate_v2

COMMON = ("package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc", ".nvmrc", ".dockerignore",
          "scripts/components.py", "deploy/artifacts.py", ".github/workflows/e2e.yml")
INPUTS = {
    "api": (*COMMON, "apps/api", "libs/shared", "libs/database"),
    "web": (*COMMON, "apps/web", "libs/shared", "libs/database"),
    "migrator": (*COMMON, "apps/api/Dockerfile", "apps/api/package.json", "libs/shared/package.json", "libs/database"),
}


def git(*arguments, cwd=None):
    result = subprocess.run(["git", *arguments], cwd=cwd, capture_output=True)
    if result.returncode:
        raise ValueError("Cannot establish component source identity")
    return result.stdout


def input_hash(revision, name, cwd=None):
    if not SHA.fullmatch(revision) or name not in COMPONENTS:
        raise ValueError("Invalid component source")
    entries = git("ls-tree", "-r", "-z", "--full-tree", revision, "--", *INPUTS[name], cwd=cwd)
    if not entries:
        raise ValueError("Component source inputs are missing")
    return hashlib.sha256(b"openathlete-component-v2/linux-amd64/" + name.encode() + b"\0" + entries).hexdigest()


def build_plan(revision, version, previous=None, *, publish=False, cwd=None):
    if not SHA.fullmatch(revision) or not SEMVER.fullmatch(version):
        raise ValueError("Invalid release identity")
    old = None
    if previous and previous.get("schemaVersion") == 2:
        old = validate_v2(previous)
    plan = {"version": version, "revision": revision, "publish": publish, "components": {}}
    for name in COMPONENTS:
        digest = input_hash(revision, name, cwd)
        own = {"revision": revision, "version": version, "inputs": digest}
        reused = False
        if old and old["components"][name]["inputs"] == digest:
            before = old["components"][name]
            try:
                git("merge-base", "--is-ancestor", before["revision"], revision, cwd=cwd)
                reused = input_hash(before["revision"], name, cwd) == digest
            except ValueError:
                reused = False
            if reused:
                own = before.copy()
        plan["components"][name] = {**own, "build": not reused,
                                    "image": old["images"][name] if reused else ""}
    return plan


def verify_provenance(candidate):
    validate_v2(candidate, local=True)
    for name in COMPONENTS:
        own = candidate["components"][name]
        git("merge-base", "--is-ancestor", own["revision"], candidate["revision"])
        if input_hash(candidate["revision"], name) != own["inputs"] or input_hash(own["revision"], name) != own["inputs"]:
            raise ValueError(f"{name} inputs differ from their tested image source")


def component_record(plan, name, digest=None):
    own = plan["components"][name]
    if plan["publish"]:
        if own["build"]:
            if not re.fullmatch(r"sha256:[a-f0-9]{64}", digest or ""):
                raise ValueError("A built registry image needs its immutable digest")
            image = f"{repository(name)}@{digest}"
        else:
            image = own["image"]
    else:
        image = f"openathlete-{name}:e2e"
    return {"name": name, "image": image, "metadata": {key: own[key] for key in ("revision", "version", "inputs")}}


def merge_records(plan, records):
    if len(records) != len(COMPONENTS) or {record.get("name") for record in records} != set(COMPONENTS):
        raise ValueError("Missing or repeated component build record")
    candidate = {"schemaVersion": 2, "version": plan["version"], "revision": plan["revision"],
                 "images": {}, "components": {}}
    for record in records:
        name = record["name"]
        own = plan["components"][name]
        expected = component_record(plan, name, record["image"].split("@")[-1])
        if record != expected:
            raise ValueError("Component build identity differs from its source plan")
        candidate["images"][name] = record["image"]
        candidate["components"][name] = record["metadata"]
    return validate_v2(candidate, local=not plan["publish"])


def verify_images(candidate):
    verify_provenance(candidate)
    for name in COMPONENTS:
        result = subprocess.run(["docker", "image", "inspect", candidate["images"][name],
                                 "--format", "{{json .Config.Labels}}"], capture_output=True, text=True)
        if result.returncode:
            raise ValueError(f"Cannot inspect tested {name} image")
        labels = json.loads(result.stdout) or {}
        if any(labels.get(key) != value for key, value in expected_labels(candidate, name).items()):
            raise ValueError(f"{name} image labels do not match its source provenance")


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    plan = commands.add_parser("plan")
    plan.add_argument("--revision", required=True)
    plan.add_argument("--publish", action="store_true")
    plan.add_argument("--output", required=True, type=Path)
    select = commands.add_parser("select")
    select.add_argument("--plan", required=True)
    select.add_argument("--component", choices=COMPONENTS, required=True)
    select.add_argument("--output", required=True, type=Path)
    record = commands.add_parser("record")
    record.add_argument("--plan", required=True)
    record.add_argument("--component", choices=COMPONENTS, required=True)
    record.add_argument("--digest")
    record.add_argument("--output", required=True, type=Path)
    merge = commands.add_parser("merge")
    merge.add_argument("--plan", required=True)
    merge.add_argument("--records", required=True, type=Path)
    merge.add_argument("--output", required=True, type=Path)
    for name in ("env", "verify"):
        command = commands.add_parser(name)
        command.add_argument("--input", required=True)
        if name == "env":
            command.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.command == "plan":
        if git("status", "--porcelain").strip():
            raise ValueError("Component plans require a clean source checkout")
        if args.publish and not (os.environ.get("GITHUB_EVENT_NAME") == "push"
                and os.environ.get("GITHUB_REF") == "refs/heads/tourmalet"
                and os.environ.get("GITHUB_REPOSITORY") == "GustaTheCreator/openathlete"
                and os.environ.get("GITHUB_SHA") == args.revision):
            raise ValueError("Only the protected stable push may publish image candidates")
        from deployer import _github_release, _request, validate_manifest
        found = _github_release()
        previous = None
        if found:
            tag, urls = found
            previous = validate_manifest(json.loads(_request(urls["manifest"])), tag, urls["source"])
        value = build_plan(args.revision, Path("VERSION").read_text().strip(), previous, publish=args.publish)
        args.output.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    elif args.command == "select":
        own = load(args.plan)["components"][args.component]
        with args.output.open("a", encoding="utf-8") as output:
            for key, value in own.items():
                print(f"{key}={str(value).lower() if isinstance(value, bool) else value}", file=output)
    elif args.command == "record":
        value = component_record(load(args.plan), args.component, args.digest)
        args.output.write_text(json.dumps(value) + "\n", encoding="utf-8")
    elif args.command == "merge":
        records = [load(path) for path in args.records.glob("component-*.json")]
        value = merge_records(load(args.plan), records)
        verify_provenance(value)
        args.output.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    else:
        value = validate_v2(load(args.input), local=True)
        if args.command == "verify":
            verify_images(value)
        else:
            with args.output.open("a", encoding="utf-8") as output:
                for name, image in value["images"].items():
                    print(f"{name.upper()}_IMAGE={image}", file=output)
                print(f"SOURCE_CODE_URL={REPOSITORY_URL}/tree/tourmalet-v{value['version']}", file=output)


if __name__ == "__main__":
    main()
