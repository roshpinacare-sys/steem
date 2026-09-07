#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${PGPASSWORD:-}" ]]; then echo "PGPASSWORD is forbidden" >&2; exit 2; fi
for var in PGHOST PGPORT PGDATABASE PGUSER PGSSLMODE PGSSLROOTCERT PGSSLCERT PGSSLKEY; do [[ -n "${!var:-}" ]] || { echo "$var is required" >&2; exit 2; }; done
[[ "${PGSSLMODE}" == "verify-full" ]] || { echo "PGSSLMODE must be verify-full" >&2; exit 2; }
psql -X --tuples-only --no-align --set=ON_ERROR_STOP=1 <<'SQL'
SELECT jsonb_pretty(jsonb_build_object(
  'serverVersionNum', current_setting('server_version_num')::int,
  'databaseSystemIdentifier', (SELECT system_identifier FROM pg_control_system()),
  'databaseName', current_database(),
  'serverAddress', inet_server_addr(),
  'serverPort', inet_server_port(),
  'sslInUse', (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),
  'transactionIsolation', current_setting('transaction_isolation'),
  'collectedAt', clock_timestamp(),
  'productionAuthority', 'NONE',
  'externalEffectsExecuted', 0
));
SQL
