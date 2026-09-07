#!/usr/bin/env bash
set -euo pipefail
root="${1:?artifact directory required}"
if grep -RIE --binary-files=without-match -- '-----BEGIN [A-Z ]*PRIVATE KEY-----|postgres(ql)?://[^[:space:]]+|PGPASSWORD[[:space:]]*=|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}' "$root"; then
  echo "possible secret material detected" >&2
  exit 1
fi
