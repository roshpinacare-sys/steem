#!/usr/bin/env bash
set -euo pipefail
root="${1:-.}"
if grep -RIE --exclude='*.md' --exclude='*.template.json' '(BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,})' "$root"; then
  echo "secret material detected" >&2; exit 1
fi
echo "no embedded secrets detected"
