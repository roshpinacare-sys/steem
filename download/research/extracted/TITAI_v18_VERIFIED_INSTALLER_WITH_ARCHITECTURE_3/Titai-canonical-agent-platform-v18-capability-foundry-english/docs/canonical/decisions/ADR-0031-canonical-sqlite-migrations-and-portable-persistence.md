# ADR-0031 — Canonical SQLite Migrations and Portable Persistence Validation

## Status
Accepted for the controlled pilot development lane.

## Problem
The repository declared multiple SQL migrations, but the legacy Drizzle journal referenced only the initial migration. Runtime startup could therefore report success while applying only a fraction of the schema. Local persistence tests were also coupled to a generated `better-sqlite3` native binding that could not be built safely on every workstation.

## Alternatives
1. Continue relying exclusively on the Drizzle journal and native driver.
2. Replace SQLite with a network database.
3. Make the ordered SQL files canonical, hash every applied migration, reject drift, and support both the existing native driver and Node's built-in SQLite implementation.

## Decision
Adopt alternative 3.

The runtime now:
- Discovers every ordered migration file matching the canonical naming contract.
- Stores the filename and SHA-256 of every applied migration.
- Rejects changed historical migrations.
- Applies each migration atomically.
- Bootstraps the legacy initial migration record without replaying it.
- Prefers `better-sqlite3` when explicitly available and supports `node:sqlite` as a transparent pilot-validation fallback.
- Keeps generated native binaries outside the source release.

## Security and sovereignty impact
The fallback removes the need to weaken endpoint protection or download an opaque binary on the protected workstation. Database access remains local. Migration drift fails closed.

## Performance impact
Both drivers are synchronous SQLite implementations. v14 records local correctness and bounded micro-evidence only; it does not claim production throughput equivalence.

## Reversibility
Set `TITAI_SQLITE_DRIVER=better-sqlite3` to retain the previous driver. The SQL schema and migration ledger are shared by both drivers.

## Acceptance evidence
- `src/lib/db/sqlite-client.ts`
- `src/lib/db/migrations.ts`
- `drizzle/0008_v14_runtime_alignment.sql`
- `tests/sqlite-driver-fallback.test.ts`
- `tests/canonical-migrations.test.ts`
- `docs/canonical/evidence/v14/multiprocess-lease-proof.json`
