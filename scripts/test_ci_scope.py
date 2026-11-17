import unittest

from ci_scope import CHECKS, classify, required_checks_pass


class ScopeTests(unittest.TestCase):
    def test_docs_and_website_are_isolated(self):
        self.assertFalse(any(classify(["README.md"]).values()))
        self.assertEqual(classify(["apps/docs/content/intro.mdx"]), dict(app=False, website=False, docs=True, deploy=False))
        self.assertEqual(classify(["apps/website/src/app.tsx"]), dict(app=False, website=True, docs=False, deploy=False))

    def test_application_and_release_keep_regression(self):
        for path in ["apps/api/src/main.ts", "apps/web/src/app.tsx", "e2e/tests/web/auth.spec.ts", "VERSION"]:
            self.assertTrue(classify([path])["app"])

    def test_shared_infrastructure_and_unknown_fail_closed(self):
        for path in ["pnpm-lock.yaml", "libs/shared/src/a.ts", "libs/database/schema.prisma", ".github/workflows/ci.yml", "scripts/ci_scope.py", "new-package/file.md"]:
            self.assertTrue(all(classify([path]).values()), path)

    def test_mixed_paths_do_not_hide_application_changes(self):
        self.assertTrue(classify(["README.md", "apps/api/src/main.ts"])["app"])

    def test_gate_rejects_missing_failed_cancelled_or_unexpected_skips(self):
        results = {"changes": {"result": "success", "outputs": dict.fromkeys(CHECKS, "false")}}
        results["changes"]["outputs"]["candidate"] = "false"
        jobs = ["lint", "type-check", "test", "integration", "e2e", "agents", "website", "docs", "deploy-tests"]
        results.update({job: {"result": "skipped"} for job in jobs})
        results["candidate"] = {"result": "skipped"}
        self.assertTrue(required_checks_pass(results))
        results["changes"]["outputs"]["app"] = "true"
        self.assertFalse(required_checks_pass(results))
        for job in jobs[:6]:
            results[job]["result"] = "success"
        self.assertTrue(required_checks_pass(results))
        results["changes"]["outputs"]["candidate"] = "true"
        self.assertFalse(required_checks_pass(results))
        results["e2e"]["result"] = "skipped"
        results["candidate"]["result"] = "success"
        self.assertTrue(required_checks_pass(results))
        results["changes"]["outputs"]["candidate"] = "false"
        results["candidate"]["result"] = "skipped"
        results["e2e"]["result"] = "success"
        for status in ["failure", "cancelled", "skipped", None]:
            results["e2e"]["result"] = status
            self.assertFalse(required_checks_pass(results))
        self.assertFalse(required_checks_pass({}))
