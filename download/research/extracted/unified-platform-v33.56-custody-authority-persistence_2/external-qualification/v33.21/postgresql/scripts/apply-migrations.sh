#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -n "${PGPASSWORD:-}" ]]; then echo "PGPASSWORD is forbidden; use a secret manager, .pgpass, workload identity, or injected credentials" >&2; exit 2; fi
for var in PGHOST PGPORT PGDATABASE PGUSER PGSSLMODE PGSSLROOTCERT PGSSLCERT PGSSLKEY; do [[ -n "${!var:-}" ]] || { echo "$var is required" >&2; exit 2; }; done
[[ "${PGSSLMODE}" == "verify-full" ]] || { echo "PGSSLMODE must be verify-full" >&2; exit 2; }
command -v psql >/dev/null || { echo "psql is required" >&2; exit 2; }
psql -X --set=ON_ERROR_STOP=1 --set=VERBOSITY=verbose -c "SELECT current_setting('server_version_num')::int AS server_version_num, current_database() AS database_name, inet_server_addr() AS server_address, ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid();"
echo "Applying migrations/001_v33_21_001.sql"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
cat "$ROOT/migrations/001_v33_21_001.sql" > "$tmp"
cat >> "$tmp" <<'SQL'
DO $$ BEGIN IF EXISTS (SELECT 1 FROM governed_authority.schema_migrations WHERE migration_id='v33.21.001' AND migration_digest<>'c6178a86cf71f6dd253b1dbec0c127f12c051f8147cb6bfeeeed41b3288748c6') THEN RAISE EXCEPTION 'migration digest conflict: v33.21.001'; END IF; END $$;
INSERT INTO governed_authority.schema_migrations(migration_id,ordinal,migration_digest,previous_migration_digest) VALUES ('v33.21.001',1,'c6178a86cf71f6dd253b1dbec0c127f12c051f8147cb6bfeeeed41b3288748c6','GENESIS') ON CONFLICT (migration_id) DO NOTHING;
SQL
psql -X --set=ON_ERROR_STOP=1 --single-transaction --file "$tmp"
rm -f "$tmp"
trap - EXIT
echo "Applying migrations/002_v33_21_002.sql"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
cat "$ROOT/migrations/002_v33_21_002.sql" > "$tmp"
cat >> "$tmp" <<'SQL'
DO $$ BEGIN IF EXISTS (SELECT 1 FROM governed_authority.schema_migrations WHERE migration_id='v33.21.002' AND migration_digest<>'db680a7061030d79b051e1272a6ba78afc3bc269f7adbeadee9e67d654a23b5a') THEN RAISE EXCEPTION 'migration digest conflict: v33.21.002'; END IF; END $$;
INSERT INTO governed_authority.schema_migrations(migration_id,ordinal,migration_digest,previous_migration_digest) VALUES ('v33.21.002',2,'db680a7061030d79b051e1272a6ba78afc3bc269f7adbeadee9e67d654a23b5a','c6178a86cf71f6dd253b1dbec0c127f12c051f8147cb6bfeeeed41b3288748c6') ON CONFLICT (migration_id) DO NOTHING;
SQL
psql -X --set=ON_ERROR_STOP=1 --single-transaction --file "$tmp"
rm -f "$tmp"
trap - EXIT
echo "Applying migrations/003_v33_21_003.sql"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
cat "$ROOT/migrations/003_v33_21_003.sql" > "$tmp"
cat >> "$tmp" <<'SQL'
DO $$ BEGIN IF EXISTS (SELECT 1 FROM governed_authority.schema_migrations WHERE migration_id='v33.21.003' AND migration_digest<>'79a27925a1ab9e7d1d903b483982de222b5b8d3b055e6c5d1949fc452a4ba456') THEN RAISE EXCEPTION 'migration digest conflict: v33.21.003'; END IF; END $$;
INSERT INTO governed_authority.schema_migrations(migration_id,ordinal,migration_digest,previous_migration_digest) VALUES ('v33.21.003',3,'79a27925a1ab9e7d1d903b483982de222b5b8d3b055e6c5d1949fc452a4ba456','db680a7061030d79b051e1272a6ba78afc3bc269f7adbeadee9e67d654a23b5a') ON CONFLICT (migration_id) DO NOTHING;
SQL
psql -X --set=ON_ERROR_STOP=1 --single-transaction --file "$tmp"
rm -f "$tmp"
trap - EXIT
psql -X --set=ON_ERROR_STOP=1 --file "$ROOT/verify-controls.sql"
