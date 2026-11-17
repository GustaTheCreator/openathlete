"""Strict image provenance shared by CI helpers and the standalone updater."""

import re

REPOSITORY_URL = "https://github.com/GustaTheCreator/openathlete"
IMAGE_PREFIX = "ghcr.io/gustathecreator/openathlete"
COMPONENTS = ("api", "web", "migrator")
SEMVER = re.compile(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\Z")
SHA = re.compile(r"[a-f0-9]{40}\Z")
HASH = re.compile(r"[a-f0-9]{64}\Z")


class DeployError(RuntimeError):
    pass


def repository(name):
    # A separate migrator image shares the already-public API package, not its tags.
    return f"{IMAGE_PREFIX}-{'api' if name == 'migrator' else name}"


def names(value):
    return COMPONENTS if value.get("schemaVersion") == 2 else ("api", "web")


def image_refs(value):
    if "images" in value:
        return value["images"]
    return {name: f"{IMAGE_PREFIX}-{name}@{value[name]}" for name in names(value)}


def image_digest(value, name):
    return image_refs(value)[name].split("@", 1)[1]


def metadata(value, name):
    if value.get("schemaVersion") == 2:
        return value["components"][name]
    return {"revision": value["revision"], "version": value["version"]}


def expected_labels(value, name):
    own = metadata(value, name)
    result = {"org.opencontainers.image.source": REPOSITORY_URL,
              "org.opencontainers.image.revision": own["revision"],
              "org.opencontainers.image.version": own["version"]}
    if "inputs" in own:
        result["org.openathlete.build-inputs"] = own["inputs"]
    return result


def validate_v2(value, *, local=False):
    if not isinstance(value, dict) or type(value.get("schemaVersion")) is not int or value["schemaVersion"] != 2:
        raise ValueError("Unsupported component schema")
    if not isinstance(value.get("version"), str) or not SEMVER.fullmatch(value["version"]):
        raise ValueError("Invalid component release version")
    if not isinstance(value.get("revision"), str) or not SHA.fullmatch(value["revision"]):
        raise ValueError("Invalid component release revision")
    if not isinstance(value.get("images"), dict) or set(value["images"]) != set(COMPONENTS):
        raise ValueError("Exactly API, web and migrator images are required")
    if not isinstance(value.get("components"), dict) or set(value["components"]) != set(COMPONENTS):
        raise ValueError("Every image requires component provenance")
    for name in COMPONENTS:
        image = value["images"][name]
        if not isinstance(image, str) or not (
            re.fullmatch(re.escape(repository(name) + "@sha256:") + r"[a-f0-9]{64}", image)
            or (local and image == f"openathlete-{name}:e2e")
        ):
            raise ValueError(f"Invalid immutable {name} image")
        own = value["components"][name]
        if (not isinstance(own, dict) or set(own) != {"revision", "version", "inputs"}
                or not isinstance(own["revision"], str) or not SHA.fullmatch(own["revision"])
                or not isinstance(own["version"], str) or not SEMVER.fullmatch(own["version"])
                or not isinstance(own["inputs"], str) or not HASH.fullmatch(own["inputs"])):
            raise ValueError(f"Invalid {name} component provenance")
        if tuple(map(int, own["version"].split("."))) > tuple(map(int, value["version"].split("."))):
            raise ValueError("Component version is newer than its release")
    return value
