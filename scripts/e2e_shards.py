"""Plan balanced Playwright shards and fail closed on incomplete reports."""

import argparse
import hashlib
import json
import re
from pathlib import Path


DEFAULT_DURATION = 1.0
SEPARATOR = re.compile(r"[\r\n›>]")


def load_json(path):
    text = Path(path).read_text(encoding="utf-8-sig")
    start = text.find("{")
    if start < 0:
        raise ValueError(f"No JSON object in {path}")
    return json.JSONDecoder().raw_decode(text[start:])[0]


def visit_suites(suites, parents=()):
    for suite in suites:
        title = suite.get("title", "")
        chain = parents + ((title,) if title else ())
        for spec in suite.get("specs", []):
            yield spec, chain
        yield from visit_suites(suite.get("suites", []), chain)


def identity(project, file, suite, title, line=0, column=0):
    raw = json.dumps([project, file.replace("\\", "/"), suite, title, line, column],
                     ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def meaningful_suites(suite, file):
    normalized_file = file.replace("\\", "/")
    return tuple(title for title in suite if title.replace("\\", "/") != normalized_file)


def report_identities(report, executed_only=False):
    found = []
    for spec, suite in visit_suites(report.get("suites", [])):
        for test in spec.get("tests", []):
            if executed_only and (not test.get("results") or test.get("status") == "skipped"):
                continue
            file = spec.get("file", "").replace("\\", "/")
            found.append(identity(test.get("projectName", ""), file,
                                  meaningful_suites(suite, file), spec.get("title", ""),
                                  spec.get("line", 0), spec.get("column", 0)))
    return found


def _entries(discovery, timings):
    duration_map = timings.get("tests", {})
    tests = []
    for spec, suite in visit_suites(discovery.get("suites", [])):
        file = spec.get("file", "").replace("\\", "/")
        if not file or file.startswith("/") or ".." in Path(file).parts:
            raise ValueError("Discovery contains an unsafe test path")
        for test in spec.get("tests", []):
            project = test.get("projectName", "")
            title = spec.get("title", "")
            suite = meaningful_suites(suite, file)
            key = identity(project, file, suite, title, spec.get("line", 0), spec.get("column", 0))
            weight = duration_map.get(key, DEFAULT_DURATION)
            if not isinstance(weight, (int, float)) or weight <= 0:
                weight = DEFAULT_DURATION
            tests.append({"id": key, "project": project, "file": file, "suite": suite,
                          "title": title, "weight": float(weight)})

    # A title that the native test-list parser cannot represent makes the file
    # indivisible; selecting the project/file still includes every test in it.
    grouped = {}
    for test in tests:
        group = (test["project"], test["file"])
        grouped.setdefault(group, []).append(test)
    units = []
    for (project, file), group in grouped.items():
        unsafe = any(SEPARATOR.search(value) for test in group
                     for value in [project, file, *test["suite"], test["title"]])
        if unsafe:
            units.append({"tests": group, "line": f"[{project}] › {file}",
                          "weight": sum(item["weight"] for item in group), "fileUnit": True})
            continue
        for test in group:
            labels = [f"[{project}]", file, *test["suite"], test["title"]]
            units.append({"tests": [test], "line": " › ".join(labels),
                          "weight": test["weight"], "fileUnit": False})
    return tests, units


def build_plan(discovery, timings, changed_files=(), shard_count=2):
    if shard_count != 2:
        raise ValueError("Exactly two shards are supported")
    tests, units = _entries(discovery, timings)
    if not tests:
        raise ValueError("Discovery found no tests")
    test_ids = [test["id"] for test in tests]
    if len(test_ids) != len(set(test_ids)):
        raise ValueError("Discovery contains duplicate test identities")
    changed = {path.strip().replace("\\", "/") for path in changed_files if path.strip()}
    bins = [{"units": [], "weight": 0.0} for _ in range(shard_count)]
    for unit in sorted(units, key=lambda item: (-item["weight"], item["line"])):
        target = min(range(shard_count), key=lambda index: (bins[index]["weight"], index))
        bins[target]["units"].append(unit)
        bins[target]["weight"] += unit["weight"]
    all_lines = sorted(unit["line"] for item in bins for unit in item["units"])
    if len(all_lines) != len(set(all_lines)):
        raise ValueError("Plan contains duplicate test-list entries")
    plan = {"all": all_lines, "expected": sorted(test["id"] for test in tests), "shards": []}
    for index, bucket in enumerate(bins, 1):
        first_units = [unit for unit in bucket["units"]
                       if any(test["file"] in changed or f"e2e/tests/{test['file']}" in changed
                              for test in unit["tests"])]
        rest_units = [unit for unit in bucket["units"] if unit not in first_units]
        first_ids = sorted(test["id"] for unit in first_units for test in unit["tests"])
        rest_ids = sorted(test["id"] for unit in rest_units for test in unit["tests"])
        plan["shards"].append({"index": index, "all": sorted(u["line"] for u in bucket["units"]),
                               "first": sorted(u["line"] for u in first_units),
                               "rest": sorted(u["line"] for u in rest_units),
                               "firstExpected": first_ids, "restExpected": rest_ids,
                               "weightSeconds": round(bucket["weight"], 2)})
    return plan


def verify_reports(expected, reports):
    wanted = expected["expected"]
    seen = []
    measurements = []
    for path in reports:
        report = load_json(path)
        seen.extend(report_identities(report, executed_only=True))
        stats = report.get("stats", {})
        measurements.append({"name": Path(path).name,
                             "durationSeconds": round(stats.get("duration", 0) / 1000, 2),
                             "passed": stats.get("expected", 0), "failed": stats.get("unexpected", 0),
                             "skipped": stats.get("skipped", 0), "flaky": stats.get("flaky", 0)})
    duplicates = sorted({item for item in seen if seen.count(item) > 1})
    missing = sorted(set(wanted) - set(seen))
    unexpected = sorted(set(seen) - set(wanted))
    if duplicates or missing or unexpected or len(seen) != len(wanted):
        raise ValueError(json.dumps({"missing": missing, "duplicates": duplicates,
                                     "unexpected": unexpected}, separators=(",", ":")))
    return {"schemaVersion": 1, "expectedTests": len(wanted), "reportedTests": len(seen),
            "identitiesSha256": hashlib.sha256("\n".join(sorted(wanted)).encode()).hexdigest(),
            "reports": measurements, "verified": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    plan_parser = sub.add_parser("plan")
    plan_parser.add_argument("--discovery", required=True, type=Path)
    plan_parser.add_argument("--timings", required=True, type=Path)
    plan_parser.add_argument("--changed", type=Path)
    plan_parser.add_argument("--output-dir", required=True, type=Path)
    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("--expected", required=True, type=Path)
    verify_parser.add_argument("--report", action="append", required=True, type=Path)
    verify_parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.command == "plan":
        changed = args.changed.read_text(encoding="utf-8").splitlines() if args.changed and args.changed.exists() else []
        plan = build_plan(load_json(args.discovery), load_json(args.timings), changed)
        args.output_dir.mkdir(parents=True, exist_ok=True)
        shard_lists = [(f"shard{s['index']}-{part}", s[part])
                       for s in plan["shards"] for part in ("all", "first", "rest")]
        for name, lines in [("all", plan["all"]), *shard_lists]:
            (args.output_dir / f"{name}.txt").write_text("".join(line + "\n" for line in lines), encoding="utf-8")
        (args.output_dir / "expected.json").write_text(json.dumps(plan, indent=2) + "\n", encoding="utf-8")
    else:
        receipt = verify_reports(load_json(args.expected), args.report)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
