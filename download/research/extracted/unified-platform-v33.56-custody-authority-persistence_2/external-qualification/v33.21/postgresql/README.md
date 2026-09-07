# PostgreSQL Durable Authority Operator Kit — V33.21

Contents:

- `migration-manifest.json`: digest-linked migration chain.
- `migrations/`: deterministic PostgreSQL schema and function migrations.
- `verify-controls.sql`: read-only structural and runtime checks.
- `operator.env.example`: secret-free environment template.
- `scripts/apply-migrations.sh`: fail-closed migration runner.
- `scripts/collect-facts.sh`: evidence fact collector.
- `RUNBOOK.md`: two-operator external qualification procedure.

Local execution in the release environment reports PostgreSQL as unavailable and therefore does not produce a live observation.
