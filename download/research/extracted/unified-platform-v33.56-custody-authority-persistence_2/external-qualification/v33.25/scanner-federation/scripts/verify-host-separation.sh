#!/usr/bin/env bash
set -euo pipefail
[ "$#" -ge 4 ] || { echo "four scanner host identifiers required" >&2; exit 2; }
printf '%s\n' "$@" | sort -u | awk 'END { exit(NR >= 4 ? 0 : 1) }'
