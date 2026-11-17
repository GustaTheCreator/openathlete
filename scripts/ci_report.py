"""Write a small, public CI receipt without copying test payloads or service logs."""

import argparse
import json
import re
from datetime import datetime
from pathlib import Path


def seconds(start, end):
    if not start or not end:
        return None
    return round(max(0, (datetime.fromisoformat(end.replace("Z", "+00:00"))
                         - datetime.fromisoformat(start.replace("Z", "+00:00"))).total_seconds()), 2)


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


def receipt(revision, version, jobs, reports, api_digest=None, web_digest=None):
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("Invalid source revision")
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("Invalid release version")
    images = {}
    for name, digest in (("api", api_digest), ("web", web_digest)):
        if digest:
            if not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
                raise ValueError("Invalid image digest")
            images[name] = digest
    timings = [{"name": job["name"], "result": job.get("conclusion"),
                "durationSeconds": seconds(job.get("started_at"), job.get("completed_at")),
                "steps": [{"name": step["name"], "result": step.get("conclusion"),
                           "durationSeconds": seconds(step.get("started_at"), step.get("completed_at"))}
                          for step in job.get("steps", [])]}
               for job in jobs.get("jobs", [])]
    return {"revision": revision, "version": version, "images": images,
            "tests": {name: test_counts(report) for name, report in reports.items()}, "jobs": timings}


def summary(data):
    lines = ["## Verification receipt", "", f"Revision: `{data['revision']}`; version: `{data['version']}`.", ""]
    for name, digest in data["images"].items():
        lines.append(f"- {name}: `{digest}`")
    for name, stats in data["tests"].items():
        lines.append(f"- {name}: {stats['passed']} passed, {stats['flaky']} flaky, "
                     f"{stats['failed']} failed, {stats['skipped']} skipped; "
                     f"{stats['retries']} retries; {stats['durationSeconds']} seconds.")
    lines.extend(["", "| Job / step | Result | Seconds |", "| --- | --- | --- |"])
    for job in data["jobs"]:
        for item in [job, *job["steps"]]:
            name = item["name"].replace("|", "\\|").replace("\n", " ").replace("\r", " ")
            lines.append(f"| {name} | {item['result'] or 'running'} | {item['durationSeconds']} |")
    if not data["jobs"]:
        lines.append("| Timing metadata unavailable | unknown | — |")
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--api-digest")
    parser.add_argument("--web-digest")
    parser.add_argument("--jobs", required=True, type=Path)
    parser.add_argument("--report", action="append", default=[], type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--summary", required=True, type=Path)
    args = parser.parse_args()
    reports = {path.stem: json.loads(path.read_text()) for path in args.report if path.exists()}
    data = receipt(args.revision, args.version, json.loads(args.jobs.read_text()), reports,
                   args.api_digest, args.web_digest)
    args.output.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    with args.summary.open("a", encoding="utf-8") as output:
        output.write(summary(data))


if __name__ == "__main__":
    main()
