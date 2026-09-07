#!/usr/bin/env bash
set -euo pipefail
[ "$#" -eq 4 ] || { echo "usage: $0 CLAM_HOST YARA_HOST CLAM_ORG YARA_ORG" >&2; exit 2; }
[ "$1" != "$2" ] && [ "$3" != "$4" ] || { echo "scanner separation failed" >&2; exit 1; }
echo "scanner separation verified"
