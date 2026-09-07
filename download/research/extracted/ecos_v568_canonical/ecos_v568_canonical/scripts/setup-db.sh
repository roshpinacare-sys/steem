#!/usr/bin/env bash
set -e
DB_URL="${DATABASE_URL:-postgresql://ecos_user:ecos_secure_pass@localhost:5432/ecos_b2b}"
echo "ECOS DB Setup — $DB_URL"
command -v psql >/dev/null 2>&1 || { echo "❌ psql not found."; exit 1; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_DIR="$(dirname "$SCRIPT_DIR")"
for f in schema.sql migration_phase2.sql migration_phase3_interlock.sql migration_phase3_ml.sql; do
  psql "$DB_URL" -f "$ENGINE_DIR/db/$f" -v ON_ERROR_STOP=1
  echo "✓ $f"
done

# [P1-V94] Deposit idempotency table — dedicated table for deposit idempotency checks.
# Uses a simpler schema than the generic idempotency_keys table: no TTL column,
# key_hash is the primary key (sha256 of route+idempotencyKey).
psql "$DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS deposit_idempotency (
  key_hash    VARCHAR(64)  PRIMARY KEY,
  fingerprint VARCHAR(32)  NOT NULL,
  result      JSONB        NOT NULL,
  created_at  TIMESTAMPTZ  DEFAULT NOW()
);
SQL
echo "✓ deposit_idempotency table"

TABLES=$(psql "$DB_URL" -t -c "SELECT tablename FROM pg_tables WHERE schemaname='public';")
REQUIRED="accounts approvals audit_log delta_trace_heads idempotency_keys ledger_entries missions deposit_idempotency"
MISSING=""
for t in $REQUIRED; do
  echo "$TABLES" | grep -q "$t" || MISSING="$MISSING $t"
done
if [ -z "$MISSING" ]; then
  echo "✅ ECOS DB ready"
else
  echo "❌ Missing:$MISSING"; exit 1
fi
