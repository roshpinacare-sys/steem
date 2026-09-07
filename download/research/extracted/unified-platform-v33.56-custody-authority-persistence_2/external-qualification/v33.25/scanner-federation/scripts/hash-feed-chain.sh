#!/usr/bin/env bash
set -euo pipefail
for file in "$@"; do sha256sum -- "$file"; done
