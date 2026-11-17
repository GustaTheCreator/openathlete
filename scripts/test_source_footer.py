import os
import shlex
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


class RuntimeSourceTests(unittest.TestCase):
    def test_only_index_changes_and_multiline_injection_is_rejected(self):
        bash = str(Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Git/bin/bash.exe") if os.name == "nt" else shutil.which("bash")
        if not bash or not Path(bash).exists():
            self.skipTest("Bash is required for the Nginx startup script")
        script = (Path(__file__).resolve().parents[1] / "apps/web/docker/50-source-code-url.sh").read_text()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            index = root / "index.html"
            asset = root / "unchanged.js"
            asset.write_text("public cached bundle")
            command = script.replace("INDEX=/usr/share/nginx/html/index.html", "INDEX=" + shlex.quote(index.as_posix()))
            for url, expected in [("https://github.com/GustaTheCreator/openathlete/tree/tourmalet-v1.8.1", 0),
                                  ("https://example.com/valid\n<script>bad</script>", 1)]:
                index.write_text('<meta content="__OPENATHLETE_SOURCE_CODE_URL__">')
                result = subprocess.run([bash, "-c", command], env={**os.environ, "SOURCE_CODE_URL": url}, capture_output=True)
                self.assertEqual(result.returncode, expected)
                if not expected:
                    self.assertIn(url, index.read_text())
                self.assertEqual(asset.read_text(), "public cached bundle")
