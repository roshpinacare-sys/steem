#!/usr/bin/env bash
set -euo pipefail
if command -v psql >/dev/null 2>&1 && [[ -n "${V32_10_POSTGRES_URL:-}" ]]; then
  export DATABASE_URL="$V32_10_POSTGRES_URL"
  exec node scripts/qualify-postgres-v32.mjs
fi
if command -v docker >/dev/null 2>&1 || command -v podman >/dev/null 2>&1; then
  echo "container runtime detected, but an administrator must provide an approved digest-pinned PostgreSQL 17 image and storage policy" >&2
  exit 2
fi
echo "PostgreSQL qualification blocked: provide psql + V32_10_POSTGRES_URL or an approved Docker/Podman runtime" >&2
exit 2
