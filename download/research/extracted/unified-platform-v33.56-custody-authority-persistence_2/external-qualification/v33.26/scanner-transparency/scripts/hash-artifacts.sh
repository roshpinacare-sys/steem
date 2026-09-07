#!/usr/bin/env bash
set -euo pipefail
[ "$#" -gt 0 ] || { echo "usage: $0 FILE..." >&2; exit 2; }
sha256sum -- "$@"
