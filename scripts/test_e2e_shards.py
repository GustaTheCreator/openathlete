import unittest
import json
import tempfile
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent))
from e2e_shards import build_plan, identity, verify_reports


def discovery(tests):
    return {"suites": [{"title": "sample.spec.ts", "file": "sample.spec.ts", "specs": [
        {"id": f"spec-{index}", "title": title, "file": "sample.spec.ts", "tests": [
            {"projectName": project, "results": [], "status": "skipped"}
        ]} for index, (project, title) in enumerate(tests)
    ]}]}


class ShardPlanTests(unittest.TestCase):
    def test_weighted_balance_and_new_test_default(self):
        data = discovery([("desktop", "slow"), ("desktop", "known"), ("desktop", "new")])
        durations = {"tests": {identity("desktop", "sample.spec.ts", (), "slow", 0, 0): 8,
                               identity("desktop", "sample.spec.ts", (), "known", 0, 0): 7}}
        plan = build_plan(data, durations)
        loads = [shard["weightSeconds"] for shard in plan["shards"]]
        self.assertLessEqual(max(loads) - min(loads), 1)
        self.assertEqual(sorted(plan["expected"]), sorted(
            plan["shards"][0]["firstExpected"] + plan["shards"][0]["restExpected"] +
            plan["shards"][1]["firstExpected"] + plan["shards"][1]["restExpected"]))

    def test_changed_units_are_first_and_complementary(self):
        plan = build_plan(discovery([("desktop", "a"), ("desktop", "b")]), {}, ["sample.spec.ts"])
        for shard in plan["shards"]:
            self.assertEqual(shard["all"], sorted(shard["first"] + shard["rest"]))
            self.assertFalse(set(shard["first"]) & set(shard["rest"]))
            self.assertEqual(shard["all"], shard["first"])

    def test_unrepresentable_title_falls_back_to_project_file(self):
        plan = build_plan(discovery([("desktop", "unsafe › title"), ("desktop", "safe")]), {})
        self.assertIn("[desktop] › sample.spec.ts", plan["all"])
        self.assertEqual(len(plan["all"]), 1)
        self.assertEqual(len(plan["expected"]), 2)

    def test_report_coverage_rejects_missing_and_duplicate(self):
        expected_ids = [identity("desktop", "", ("suite",), "one"),
                        identity("desktop", "", ("suite",), "two")]
        expected = {"expected": expected_ids}

        def report(ids):
            return {"suites": [{"title": "suite", "specs": [
                {"id": test_id, "title": test_id, "tests": [{"projectName": "desktop", "results": [{}]}]}
                for test_id in ids
            ]}]}

        with tempfile.TemporaryDirectory() as directory:
            def save(name, data):
                path = Path(directory) / name
                path.write_text(json.dumps(data), encoding="utf-8")
                return path

            with self.assertRaises(ValueError):
                verify_reports(expected, [save("missing.json", report(["one"]))])
            with self.assertRaises(ValueError):
                verify_reports(expected, [save("complete.json", report(["one", "two"])),
                                          save("duplicate.json", report(["two"]))])


if __name__ == "__main__":
    unittest.main()
