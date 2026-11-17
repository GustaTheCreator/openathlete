"""Exercise verify.sh failure teardown without Docker or package installation."""

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


class VerifyCleanupTests(unittest.TestCase):
    def test_e2e_teardown_on_start_failure_test_failure_and_success(self):
        bash = str(Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Git/bin/bash.exe") if os.name == "nt" else shutil.which("bash")
        if not bash or not Path(bash).exists():
            self.skipTest("Bash is unavailable")
        script = Path(__file__).resolve().parent / "verify.sh"
        for failure in ("e2e stack:up", "e2e test:e2e", ""):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                log = root / "calls.log"
                pnpm = root / "pnpm"
                pnpm.write_text(
                    '#!/usr/bin/env bash\n'
                    'echo "$*" >> "$CALL_LOG"\n'
                    'if [[ "$*" == "$FAIL_STEP" ]]; then exit 17; fi\n',
                    encoding="utf-8", newline="\n",
                )
                pnpm.chmod(0o755)
                result = subprocess.run(
                    [bash, script.as_posix(), "--e2e"], capture_output=True, text=True,
                    env={**os.environ, "PATH": str(root) + os.pathsep + os.environ["PATH"],
                         "CALL_LOG": log.as_posix(), "FAIL_STEP": failure},
                )
                self.assertEqual(result.returncode, 1 if failure else 0, result.stdout + result.stderr)
                calls = log.read_text().splitlines()
                self.assertEqual(calls.count("e2e stack:down"), 1)
                if failure == "e2e stack:up":
                    self.assertNotIn("e2e test:e2e", calls)
