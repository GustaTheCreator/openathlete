"""Redact credentials and personal addresses from isolated E2E service logs."""

import re
import sys


def redact(text):
    text = re.sub(r"(?i)(\b(?:cookie|set-cookie):\s*).*", r"\1[redacted]", text)
    text = re.sub(r'''((?:https?://|/)[^\s?"<>]+)\?[^\s"<>]+''', r"\1?[redacted]", text)
    text = re.sub(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", "[email]", text)
    text = re.sub(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b", "[token]", text)
    text = re.sub(r"(?i)\bBearer\s+\S+", "Bearer [redacted]", text)
    text = re.sub(r"(https?://)[^\s/@]+:[^\s/@]+@", r"\1[redacted]@", text)
    # Loggers use JSON, key=value and header forms; keep the key for diagnosis.
    text = re.sub(
        r'''(?ix)(["']?[\w-]*(?:token|secret|password|authorization|cookie|api[-_]?key)[\w-]*["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)''',
        r'\1"[redacted]"', text,
    )
    return text


if __name__ == "__main__":
    for line in sys.stdin:
        sys.stdout.write(redact(line))
