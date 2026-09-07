# PostgreSQL bake-off target

The next environment-qualified run must execute the canonical fault suite against PostgreSQL with:

- at least four worker processes;
- `READ COMMITTED` and `SERIALIZABLE` comparisons;
- `SELECT ... FOR UPDATE SKIP LOCKED` outbox claiming;
- advisory or row locks only where justified;
- lease expiry and stale-fence rejection;
- process termination before effect, after effect, and before acknowledgement;
- network interruption between worker and database;
- schema migration during suspended approval;
- duplicate and reordered delivery;
- 24-hour approval wait simulation;
- event/evidence chain reconstruction.

The current environment has no PostgreSQL server or client, so this gate is `BLOCKED_ENVIRONMENT`, not passed.
