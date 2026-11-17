"""Prioritize changed specs without executing them again in the remaining suite."""

import argparse
import re
import subprocess
from pathlib import Path


def changed_specs(paths):
    specs = []
    for path in paths:
        if not path.startswith("e2e/tests/") or not path.endswith(".spec.ts"):
            continue
        # Fall back to the complete suite if a path cannot be represented literally.
        if not re.fullmatch(r"e2e/tests/[A-Za-z0-9_./-]+\.spec\.ts", path) or ".." in Path(path).parts:
            return []
        specs.append(path.removeprefix("e2e/tests/"))
    return sorted(set(specs))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True)
    parser.add_argument("--head", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if not all(re.fullmatch(r"[a-f0-9]{40}", revision) for revision in (args.base, args.head)):
        parser.error("Base and head must be full Git revisions")
    result = subprocess.run(["git", "diff", "--name-only", "--diff-filter=AM", "--no-renames", "-z",
                             f"{args.base}...{args.head}"], capture_output=True)
    paths = result.stdout.decode(errors="surrogateescape").split("\0") if result.returncode == 0 else []
    args.output.write_text("".join(path + "\n" for path in changed_specs(paths)), encoding="utf-8")


if __name__ == "__main__":
    main()
