#!/usr/bin/env bash
set -euo pipefail
for command in clamscan freshclam yara yarac; do
  if command -v "$command" >/dev/null 2>&1; then "$command" --version 2>&1 | head -n 1; else echo "$command: UNAVAILABLE_FAIL_CLOSED"; fi
done
