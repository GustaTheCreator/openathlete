import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import components


class ComponentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for args in [("init", "-q"), ("config", "user.name", "CI fixture"),
                     ("config", "user.email", "fixture@example.invalid"), ("config", "commit.gpgsign", "false")]:
            components.git(*args, cwd=self.root)
        for file in ["package.json", "pnpm-lock.yaml", "apps/api/Dockerfile", "apps/web/Dockerfile",
                     "apps/api/src/main.ts", "apps/web/src/main.ts", "libs/shared/src/index.ts",
                     "libs/database/prisma/schema.prisma"]:
            path = self.root / file
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("public fixture\n")
        self.before = self.commit()
        self.old = {"schemaVersion": 2, "version": "1.8.0", "revision": self.before,
                    "images": {name: components.repository(name) + "@sha256:" + "b" * 64 for name in components.COMPONENTS},
                    "components": {name: {"version": "1.8.0", "revision": self.before,
                                           "inputs": components.input_hash(self.before, name, self.root)}
                                   for name in components.COMPONENTS}}

    def commit(self):
        components.git("add", ".", cwd=self.root)
        components.git("commit", "-qm", "Public test fixture", cwd=self.root)
        return components.git("rev-parse", "HEAD", cwd=self.root).decode().strip()

    def change(self, file):
        (self.root / file).write_text("changed public fixture\n")
        return self.commit()

    def test_web_only_change_reuses_exact_api_and_migrator(self):
        after = self.change("apps/web/src/main.ts")
        plan = components.build_plan(after, "1.8.1", self.old, publish=True, cwd=self.root)
        self.assertEqual({name: own["build"] for name, own in plan["components"].items()},
                         {"api": False, "web": True, "migrator": False})
        records = [components.component_record(plan, name, "sha256:" + "d" * 64) for name in components.COMPONENTS]
        candidate = components.merge_records(plan, records)
        self.assertEqual(candidate["images"]["api"], self.old["images"]["api"])
        self.assertEqual(candidate["components"]["api"]["revision"], self.before)
        self.assertEqual(candidate["components"]["web"]["revision"], after)
        with self.assertRaises(ValueError):
            components.merge_records(plan, [records[0], records[0], records[2]])

    def test_shared_and_database_transitive_inputs_are_conservative(self):
        after = self.change("libs/shared/src/index.ts")
        plan = components.build_plan(after, "1.8.1", self.old, cwd=self.root)
        self.assertTrue(plan["components"]["api"]["build"])
        self.assertTrue(plan["components"]["web"]["build"])
        self.assertFalse(plan["components"]["migrator"]["build"])
        after = self.change("libs/database/prisma/schema.prisma")
        self.assertTrue(all(own["build"] for own in components.build_plan(after, "1.8.1", self.old, cwd=self.root)["components"].values()))

    def test_new_version_reuses_images_but_unknown_legacy_provenance_rebuilds(self):
        plan = components.build_plan(self.before, "1.8.1", self.old, cwd=self.root)
        self.assertFalse(any(own["build"] for own in plan["components"].values()))
        legacy = {"schemaVersion": 1, "version": "1.7.3"}
        self.assertTrue(all(own["build"] for own in components.build_plan(self.before, "1.8.1", legacy, cwd=self.root)["components"].values()))
        self.old["components"]["api"]["revision"] = "e" * 40
        self.assertTrue(components.build_plan(self.before, "1.8.1", self.old, cwd=self.root)["components"]["api"]["build"])

    def test_pr_cannot_request_publication_even_with_a_clean_checkout(self):
        with patch.object(components, "git", return_value=b""), \
                patch.dict(os.environ, {"GITHUB_EVENT_NAME": "pull_request", "GITHUB_REF": "refs/pull/1/merge",
                                        "GITHUB_REPOSITORY": "GustaTheCreator/openathlete"}, clear=True), \
                patch("sys.argv", ["components.py", "plan", "--revision", "a" * 40, "--publish", "--output", str(self.root / "out.json")]):
            with self.assertRaisesRegex(ValueError, "protected stable push"):
                components.main()
