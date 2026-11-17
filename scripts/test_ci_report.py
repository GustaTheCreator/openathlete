import unittest

from ci_report import receipt, summary


class ReceiptTests(unittest.TestCase):
    def test_counts_retries_and_step_timings_without_payloads(self):
        report = {"stats": {"expected": 2, "flaky": 1, "unexpected": 1, "skipped": 3, "duration": 1234},
                  "suites": [{"specs": [{"tests": [{"results": [{"retry": 0, "error": "private"}, {"retry": 1}]}]}]}]}
        jobs = {"jobs": [{"name": "Images", "conclusion": None,
                          "steps": [{"name": "Build", "started_at": "2026-11-17T10:00:00Z",
                                     "completed_at": "2026-11-17T10:00:07Z", "conclusion": "success"}]}]}
        result = receipt("a" * 40, "1.7.3", jobs, {"regression": report}, "sha256:" + "b" * 64)
        self.assertEqual(result["tests"]["regression"], dict(passed=2, flaky=1, failed=1, skipped=3,
                                                          retries=1, durationSeconds=1.23))
        self.assertEqual(result["jobs"][0]["steps"][0]["durationSeconds"], 7)
        self.assertIsNone(result["jobs"][0]["durationSeconds"])
        self.assertNotIn("private", str(result))
        self.assertIn("1 retries", summary(result))

    def test_missing_metadata_is_explicit_and_identity_is_validated(self):
        self.assertIn("Timing metadata unavailable", summary(receipt("a" * 40, "1.7.3", {}, {})))
        for revision, version, digest in [("main", "1.7.3", None), ("a" * 40, "latest", None),
                                          ("a" * 40, "1.7.3", "latest")]:
            with self.assertRaises(ValueError):
                receipt(revision, version, {}, {}, digest)


if __name__ == "__main__":
    unittest.main()
