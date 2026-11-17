import unittest

from ci_report import receipt, summary


def candidate(revision="a" * 40, version="1.7.3", local=False):
    images = {
        "api": "openathlete-api:e2e" if local else "ghcr.io/gustathecreator/openathlete-api@sha256:" + "1" * 64,
        "web": "openathlete-web:e2e" if local else "ghcr.io/gustathecreator/openathlete-web@sha256:" + "2" * 64,
        "migrator": "openathlete-migrator:e2e" if local else "ghcr.io/gustathecreator/openathlete-api@sha256:" + "3" * 64,
    }
    components = {
        "api": {"revision": revision, "version": version, "inputs": "a" * 64},
        "web": {"revision": "b" * 40, "version": "1.7.2", "inputs": "b" * 64},
        "migrator": {"revision": revision, "version": version, "inputs": "c" * 64},
    }
    return {"schemaVersion": 2, "revision": revision, "version": version,
            "images": images, "components": components}


def coverage():
    return {"schemaVersion": 1, "expectedTests": 42, "reportedTests": 42,
            "identitiesSha256": "d" * 64, "reports": [
                {"name": "shard1-all-results.json", "durationSeconds": 10,
                 "passed": 40, "failed": 0, "skipped": 2, "flaky": 0}], "verified": True}


class ReceiptTests(unittest.TestCase):
    def test_candidate_v2_coverage_counts_timings_and_payload_exclusion(self):
        report = {"stats": {"expected": 2, "flaky": 1, "unexpected": 1, "skipped": 3, "duration": 1234},
                  "suites": [{"specs": [{"tests": [{"results": [
                      {"retry": 0, "error": "private"}, {"retry": 1}]}]}]}]}
        jobs = {"jobs": [{"name": "Images", "conclusion": None,
                          "started_at": "2026-11-17T10:00:00Z", "completed_at": None,
                          "steps": [{"name": "Build", "started_at": "2026-11-17T10:00:00Z",
                                     "completed_at": "2026-11-17T10:00:07Z", "conclusion": "success"}]}]}
        actual_candidate = candidate()
        actual_candidate["unexpectedPayload"] = "private"
        result = receipt("a" * 40, "1.7.3", jobs, {"regression": report}, actual_candidate, coverage())
        self.assertEqual(result["tests"]["regression"], dict(passed=2, flaky=1, failed=1, skipped=3,
                                                              retries=1, durationSeconds=1.23))
        self.assertEqual(result["jobs"][0]["steps"][0]["durationSeconds"], 7)
        self.assertIsNone(result["jobs"][0]["durationSeconds"])
        self.assertTrue(result["timingsAvailable"])
        self.assertEqual(set(result["images"]), {"api", "web", "migrator"})
        self.assertEqual(result["candidate"]["components"]["web"]["version"], "1.7.2")
        self.assertIn("Coverage: 42 of 42 tests verified.", summary(result))
        self.assertNotIn("private", str(result))
        self.assertIn("1 retries", summary(result))

    def test_accepts_pr_local_candidate_and_explicitly_marks_missing_timings(self):
        result = receipt("a" * 40, "1.7.3", {}, {}, candidate(local=True), coverage(), allow_local=True)
        self.assertEqual(result["images"]["api"], "openathlete-api:e2e")
        self.assertFalse(result["timingsAvailable"])
        self.assertIn("Timing metadata unavailable", summary(result))

    def test_release_receipt_reuses_verified_ci_counts_and_timings(self):
        actual_candidate = candidate()
        ci_report = {"stats": {"expected": 40, "flaky": 1, "unexpected": 0, "skipped": 2, "duration": 2500},
                     "suites": []}
        ci = receipt("a" * 40, "1.7.3", {"jobs": []}, {"e2e": ci_report},
                     actual_candidate, coverage())
        ci["tests"]["e2e"]["error"] = "private report payload"
        ci["jobs"] = [{"name": "E2E shards", "result": "success", "durationSeconds": 25,
                       "steps": [{"name": "Verify", "result": "success", "durationSeconds": 2}]}]
        smoke = {"stats": {"expected": 2, "flaky": 0, "unexpected": 0, "skipped": 0, "duration": 900},
                 "suites": []}
        release_jobs = {"jobs": [{"name": "Release smoke", "conclusion": "success",
                                  "started_at": "2026-11-17T10:00:00Z",
                                  "completed_at": "2026-11-17T10:00:30Z", "steps": []}]}
        result = receipt("a" * 40, "1.7.3", release_jobs, {"smoke": smoke},
                         actual_candidate, coverage(), previous=ci)
        self.assertEqual(result["tests"]["CI / e2e"]["passed"], 40)
        self.assertEqual(result["tests"]["Release / smoke"]["passed"], 2)
        self.assertEqual(result["jobs"][0]["name"], "CI / E2E shards")
        self.assertEqual(result["timingSources"], {"ci": False, "release": True})
        self.assertIn("CI timing metadata unavailable", summary(result))
        self.assertNotIn("private report payload", str(result))

        mismatched = {**ci, "revision": "b" * 40}
        with self.assertRaisesRegex(ValueError, "differs from the verified release candidate"):
            receipt("a" * 40, "1.7.3", {}, {}, actual_candidate, coverage(), previous=mismatched)

    def test_rejects_divergent_candidate_revision_or_version(self):
        for revision, version in [("b" * 40, "1.7.3"), ("a" * 40, "1.7.4")]:
            with self.subTest(revision=revision[:4], version=version), self.assertRaisesRegex(
                ValueError, "differs from the verification identity"
            ):
                receipt("a" * 40, "1.7.3", {}, {}, candidate(revision, version), coverage())

    def test_rejects_incomplete_candidate_or_coverage(self):
        invalid_candidate = candidate()
        invalid_candidate["images"].pop("migrator")
        with self.assertRaises(ValueError):
            receipt("a" * 40, "1.7.3", {}, {}, invalid_candidate, coverage())
        invalid_coverage = coverage()
        invalid_coverage["verified"] = False
        with self.assertRaisesRegex(ValueError, "full-coverage"):
            receipt("a" * 40, "1.7.3", {}, {}, candidate(), invalid_coverage)


if __name__ == "__main__":
    unittest.main()
