"""Write a compact verification receipt without test payloads or service logs."""

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "deploy"))
from artifacts import COMPONENTS, validate_v2


def seconds(start, end):
    if not isinstance(start, str) or not isinstance(end, str) or not start or not end:
        return None
    try:
        left = datetime.fromisoformat(start.replace("Z", "+00:00"))
        right = datetime.fromisoformat(end.replace("Z", "+00:00"))
        if left.tzinfo is None:
            left = left.replace(tzinfo=timezone.utc)
        if right.tzinfo is None:
            right = right.replace(tzinfo=timezone.utc)
        return round(max(0, (right - left).total_seconds()), 2)
    except (TypeError, ValueError):
        return None


def test_counts(report):
    stats = report.get("stats", {})
    retries = 0

    def visit(suites):
        nonlocal retries
        for suite in suites:
            for spec in suite.get("specs", []):
                for test in spec.get("tests", []):
                    retries += sum(result.get("retry", 0) > 0 for result in test.get("results", []))
            visit(suite.get("suites", []))

    visit(report.get("suites", []))
    return {**{key: stats.get(source, 0) for key, source in (
        ("passed", "expected"), ("flaky", "flaky"), ("failed", "unexpected"), ("skipped", "skipped")
    )}, "retries": retries, "durationSeconds": round(stats.get("duration", 0) / 1000, 2)}


def _coverage(value):
    if (not isinstance(value, dict) or type(value.get("schemaVersion")) is not int or value["schemaVersion"] != 1
            or value.get("verified") is not True
            or type(value.get("expectedTests")) is not int or value["expectedTests"] < 1
            or type(value.get("reportedTests")) is not int or value["reportedTests"] != value["expectedTests"]
            or not isinstance(value.get("identitiesSha256"), str)
            or not re.fullmatch(r"[a-f0-9]{64}", value["identitiesSha256"])
            or not isinstance(value.get("reports", []), list)):
        raise ValueError("A verified full-coverage receipt is required")
    reports = []
    for report in value.get("reports", []):
        if not isinstance(report, dict):
            raise ValueError("Invalid coverage report entry")
        name = report.get("name")
        if not isinstance(name, str) or Path(name).name != name:
            raise ValueError("Invalid coverage report name")
        reports.append({key: report.get(key) for key in (
            "name", "durationSeconds", "passed", "failed", "skipped", "flaky"
        )})
    return {"schemaVersion": 1, "expectedTests": value["expectedTests"],
            "reportedTests": value["reportedTests"], "identitiesSha256": value["identitiesSha256"],
            "reports": reports, "verified": True}


def _candidate(value, revision, version, *, allow_local=False):
    validate_v2(value, local=allow_local)
    if value["revision"] != revision or value["version"] != version:
        raise ValueError("Candidate revision or version differs from the verification identity")
    return {"schemaVersion": 2, "version": value["version"], "revision": value["revision"],
            "images": {name: value["images"][name] for name in COMPONENTS},
            "components": {name: {key: value["components"][name][key]
                                  for key in ("revision", "version", "inputs")}
                           for name in COMPONENTS}}


def _timings(jobs):
    result = []
    for job in jobs.get("jobs", []):
        steps = [{"name": step.get("name", "unknown"), "result": step.get("conclusion"),
                  "durationSeconds": seconds(step.get("started_at"), step.get("completed_at"))}
                 for step in job.get("steps", [])]
        result.append({"name": job.get("name", "unknown"), "result": job.get("conclusion"),
                       "durationSeconds": seconds(job.get("started_at"), job.get("completed_at")),
                       "steps": steps})
    available = any(item["durationSeconds"] is not None
                    for job in result for item in [job, *job["steps"]])
    return result, available


def _previous_receipt(value, revision, version, candidate, coverage):
    if (not isinstance(value, dict) or value.get("revision") != revision or value.get("version") != version
            or value.get("candidate") != candidate or value.get("coverage") != coverage
            or not isinstance(value.get("tests"), dict) or not isinstance(value.get("jobs"), list)):
        raise ValueError("Previous CI receipt differs from the verified release candidate")
    tests = {}
    for name, stats in value["tests"].items():
        if not isinstance(name, str) or not isinstance(stats, dict):
            raise ValueError("Invalid previous test counts")
        tests[f"CI / {name}"] = {key: stats.get(key) for key in (
            "passed", "flaky", "failed", "skipped", "retries", "durationSeconds"
        )}
    jobs = []
    for job in value["jobs"]:
        if not isinstance(job, dict):
            raise ValueError("Invalid previous job timing")
        steps = [{"name": step.get("name", "unknown"), "result": step.get("result"),
                  "durationSeconds": step.get("durationSeconds")}
                 for step in job.get("steps", []) if isinstance(step, dict)]
        jobs.append({"name": f"CI / {job.get('name', 'unknown')}", "result": job.get("result"),
                     "durationSeconds": job.get("durationSeconds"), "steps": steps})
    return tests, jobs


def receipt(revision, version, jobs, reports, candidate, coverage, *, allow_local=False, previous=None):
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("Invalid source revision")
    tested_candidate = _candidate(candidate, revision, version, allow_local=allow_local)
    coverage_data = _coverage(coverage)
    tests, previous_jobs = ({}, [])
    if previous is not None:
        tests, previous_jobs = _previous_receipt(
            previous, revision, version, tested_candidate, coverage_data
        )
    prefix = "Release / " if previous is not None else ""
    tests.update({prefix + name: test_counts(report) for name, report in reports.items()})
    timings, current_timings_available = _timings(jobs)
    if previous is not None:
        timings = [{"name": f"Release / {job['name']}", "result": job["result"],
                    "durationSeconds": job["durationSeconds"],
                    "steps": [{**step, "name": f"Release / {step['name']}"} for step in job["steps"]]}
                   for job in timings]
    timings = previous_jobs + timings
    timings_available = any(item["durationSeconds"] is not None
                            for job in timings for item in [job, *job["steps"]])
    timing_sources = ({"ci": previous.get("timingsAvailable") is True,
                       "release": current_timings_available}
                      if previous is not None else {"current": current_timings_available})
    return {"revision": revision, "version": version,
            "images": tested_candidate["images"], "candidate": tested_candidate,
            "coverage": coverage_data,
            "tests": tests,
            "jobs": timings, "timingsAvailable": timings_available,
            "timingSources": timing_sources}


def summary(data):
    lines = ["## Verification receipt", "", f"Revision: `{data['revision']}`; version: `{data['version']}`.", ""]
    for name, reference in data["images"].items():
        lines.append(f"- {name}: `{reference}`")
    for name, own in data["candidate"]["components"].items():
        lines.append(f"- {name} component: `{own['version']}` / `{own['revision'][:12]}`")
    coverage = data["coverage"]
    lines.append(f"- Coverage: {coverage['reportedTests']} of {coverage['expectedTests']} tests verified.")
    for name, stats in data["tests"].items():
        lines.append(f"- {name}: {stats['passed']} passed, {stats['flaky']} flaky, "
                     f"{stats['failed']} failed, {stats['skipped']} skipped; "
                     f"{stats['retries']} retries; {stats['durationSeconds']} seconds.")
    lines.extend(["", "| Job / step | Result | Seconds |", "| --- | --- | --- |"])
    for job in data["jobs"]:
        for item in [job, *job["steps"]]:
            name = str(item["name"]).replace("|", "\\|").replace("\n", " ").replace("\r", " ")
            seconds_value = item["durationSeconds"] if item["durationSeconds"] is not None else "unavailable"
            lines.append(f"| {name} | {item['result'] or 'running'} | {seconds_value} |")
    for source, available in data["timingSources"].items():
        if not available:
            label = "Timing metadata unavailable" if source == "current" else f"{source.upper()} timing metadata unavailable"
            lines.append(f"| {label} | unknown | unavailable |")
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--candidate", required=True, type=Path)
    parser.add_argument("--allow-local-candidate", action="store_true")
    parser.add_argument("--coverage", required=True, type=Path)
    parser.add_argument("--previous-receipt", type=Path)
    parser.add_argument("--jobs", required=True, type=Path)
    parser.add_argument("--report", action="append", default=[], type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--summary", required=True, type=Path)
    args = parser.parse_args()
    reports = {path.stem: json.loads(path.read_text(encoding="utf-8-sig"))
               for path in args.report if path.exists()}
    previous = (json.loads(args.previous_receipt.read_text(encoding="utf-8-sig"))
                if args.previous_receipt else None)
    data = receipt(args.revision, args.version, json.loads(args.jobs.read_text(encoding="utf-8-sig")),
                   reports, json.loads(args.candidate.read_text(encoding="utf-8-sig")),
                   json.loads(args.coverage.read_text(encoding="utf-8-sig")),
                   allow_local=args.allow_local_candidate, previous=previous)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    args.summary.parent.mkdir(parents=True, exist_ok=True)
    with args.summary.open("a", encoding="utf-8") as output:
        output.write(summary(data))


if __name__ == "__main__":
    main()
