\set ON_ERROR_STOP on
SELECT current_setting('server_version_num')::int >= 150000 AS supported_server_version;
SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid();
SELECT to_regprocedure('governed_authority.process_lease_command_v1(jsonb)') IS NOT NULL AS command_function_present;
SELECT has_schema_privilege('public', 'governed_authority', 'USAGE') AS public_authority_schema_usage;
SELECT has_schema_privilege('public', 'governed_witness', 'USAGE') AS public_witness_schema_usage;
SELECT count(*) = 5 AS required_tables_present
FROM information_schema.tables
WHERE table_schema = 'governed_authority'
  AND table_name IN ('schema_migrations','authority_state','leases','decisions','outbox');
SELECT count(*) = 1 AS witness_table_present
FROM information_schema.tables
WHERE table_schema = 'governed_witness' AND table_name = 'fences';
SELECT pg_try_advisory_xact_lock(hashtextextended('v33.21-qualification', 0)) AS transaction_advisory_lock_available;
SELECT * FROM governed_authority.integrity_summary;
SELECT (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pgcrypto') = 'governed_crypto' AS pgcrypto_schema_pinned;
SELECT count(*) = 3 AS migration_chain_recorded FROM governed_authority.schema_migrations;
SELECT bool_and(NOT rolcanlogin) AS fixed_roles_are_no_login
FROM pg_roles WHERE rolname IN ('governed_authority_runtime','governed_authority_delivery','governed_authority_verifier');
