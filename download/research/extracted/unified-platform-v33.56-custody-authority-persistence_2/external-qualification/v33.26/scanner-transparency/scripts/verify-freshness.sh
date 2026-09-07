#!/usr/bin/env bash
set -euo pipefail
[ "$#" -eq 3 ] || { echo "usage: $0 NOW_EPOCH RECEIPT_EPOCH DB_UPDATE_EPOCH" >&2; exit 2; }
(( $1 >= $2 && $1 - $2 <= 86400 )) || { echo "receipt stale" >&2; exit 1; }
(( $1 >= $3 && $1 - $3 <= 43200 )) || { echo "signature database stale" >&2; exit 1; }
echo "freshness verified"
