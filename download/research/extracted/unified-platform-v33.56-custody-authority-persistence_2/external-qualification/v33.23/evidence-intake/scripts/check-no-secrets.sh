#!/usr/bin/env bash
set -euo pipefail
root=${1:-.}
if grep -RInE --exclude='check-no-secrets.sh' -- '-----BEGIN [A-Z ]*PRIVATE KEY-----|postgres(ql)?://[^[:space:]]+:[^[:space:]@]+@|PGPASSWORD[[:space:]]*=|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}' "$root"; then
  echo 'secret-like material detected' >&2
  exit 1
fi
