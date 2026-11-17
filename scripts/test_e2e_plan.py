import unittest

from e2e_plan import changed_specs


class PlanTests(unittest.TestCase):
    def test_exact_changed_files_are_prioritized_once_and_others_remain_unfiltered(self):
        self.assertEqual(changed_specs(["e2e/tests/mobile/statistics.spec.ts", "README.md",
                                        "e2e/tests/mobile/statistics.spec.ts", "e2e/tests/auth.setup.ts"]),
                         ["mobile/statistics.spec.ts"])
        self.assertEqual(changed_specs(["apps/api/src/main.ts"]), [])

    def test_unrepresentable_paths_fall_back_to_the_complete_suite(self):
        for path in ["e2e/tests/a\nb.spec.ts", "e2e/tests/#comment.spec.ts", "e2e/tests/../outside.spec.ts", "e2e/tests/\udcff.spec.ts"]:
            self.assertEqual(changed_specs(["e2e/tests/mobile/statistics.spec.ts", path]), [])


if __name__ == "__main__":
    unittest.main()
