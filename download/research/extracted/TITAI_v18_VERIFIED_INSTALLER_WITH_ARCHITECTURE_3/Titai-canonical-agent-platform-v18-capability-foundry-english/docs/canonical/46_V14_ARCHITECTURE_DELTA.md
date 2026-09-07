# v14 Architecture Delta

## Purpose

v14 closes the largest locally executable validation gaps left by v13 without weakening the protected workstation. The release remains conservative: source, persistence, process-race, build, recovery, and failure evidence improved materially, while managed-browser and final independent-verification gates remain blocking.

## Persistence boundary

The persistence layer now exposes one Drizzle-compatible synchronous SQLite contract with two explicit drivers:

- `better-sqlite3` — the existing native production driver when its verified binding is available.
- `node:sqlite` — the Node 22 built-in validation fallback used on the protected host.

Driver selection is controlled by `TITAI_SQLITE_DRIVER=auto|better-sqlite3|node:sqlite`. Automatic selection prefers the existing native driver and falls back only when the generated binding cannot be loaded.

## Canonical migration ledger

Runtime migration authority moved from the stale Drizzle journal to the ordered SQL files in `drizzle/`.

Every applied migration records:

- filename;
- SHA-256;
- application timestamp.

Historical migration drift is rejected. Each new migration is applied within an immediate transaction. The initial legacy journal entry can be bootstrapped without replaying the initial schema.

## Runtime alignment

Migration `0008_v14_runtime_alignment.sql` adds the outbox fencing column already required by runtime code. This closes a code/schema divergence that was not visible while later migrations were skipped.

## Process-level proof boundary

v14 adds independent-process proofs for:

- lease acquisition;
- fencing-token takeover;
- stale-worker checkpoint rejection;
- approval compare-and-set;
- approval restart continuation;
- outbox claim ownership;
- duplicate publication rejection;
- database lock backpressure.

These proofs use separate Node processes sharing one local SQLite file. They do not claim distributed consensus.

## Recovery boundary

The application backup proof now restores a scoped pilot snapshot containing:

- tenant and workspace;
- membership;
- runs and steps;
- pending approval;
- artifacts;
- audit chain;
- completed durable receipt;
- verification attestation.

Restore fault injection is available at the target-displacement boundary. An injected interruption must preserve the original target database.

## Build boundary

Next.js build concurrency is bounded to two workers. Authenticated pages remain dynamically rendered. Database creation remains lazy, so route discovery does not open SQLite. The final v14 build completes without database initialization.

## Browser boundary

The local Chromium executable is governed by a deny-all URL policy. v14 does not modify or bypass that policy. Browser, accessibility, offline, and visual-regression gates remain assigned to the pinned disposable CI lane.
