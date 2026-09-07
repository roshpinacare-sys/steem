# TITAI v14 Pilot Validation Engineering Report

## Executive summary

v14 concentrated on the seven gates that prevented v13 from approaching a controlled internal pilot. It did not broaden the product surface. It repaired persistence validation, migration authority, process-level concurrency proof, scoped seed state, clean restore evidence, failure injection, and build resource control.

The most important finding was not the missing native binding. The active runtime migration path relied on a legacy journal containing only the initial migration. Source validation counted later SQL files, but runtime startup could silently omit them. v14 makes the ordered SQL files canonical, records their hashes, and rejects drift.

The complete test suite now runs without downloading or building a new native binary by using Node 22 built-in SQLite as a validation fallback. The existing `better-sqlite3` path remains available and is still required in the disposable native CI lane.

The release remains **DEVELOPMENT ONLY** because the local Chromium executable is controlled by a managed deny-all URL policy, leaving browser E2E, browser accessibility, offline behavior, and visual regression unexecuted. Final independent verification also must occur after the archive is frozen.

## Starting condition

v13 had:

- 44 passing test files and 147 tests;
- a successful production source build;
- tenant and workspace columns;
- approval continuation contracts;
- a pinned CI lane;
- 10 of 25 failure scenarios passing;
- blocked native, browser, accessibility, multi-process, clean-restore, and final-verifier gates.

## Major verified findings

### Runtime migration authority was incomplete

The Drizzle journal referenced only migration `0000`. Later files existed but were not authoritative at runtime. This could leave new databases without durable, memory, tenancy, verification, or approval schema.

### Runtime code and outbox schema diverged

The outbox implementation expected a lease token that was absent from the effective schema. Migration `0008_v14_runtime_alignment.sql` closes the mismatch.

### Demo scope was structurally incomplete

Seeded runs referenced personal tenant and workspace identifiers, but the scope tables were empty. The seed now creates the tenant, workspace, and membership before scoped agents and runs.

### Build concurrency was not bounded

The container reported a large CPU count and Next.js could spawn excessive workers. v14 limits static generation to two workers.

### Browser availability was misdiagnosed

Chromium is installed. The actual blocker is managed policy: `URLBlocklist: ["*"]`. The browser denies localhost before application navigation. v14 records the exact blocker and does not attempt to bypass it.

## Implemented architecture changes

### Portable persistence adapter

A single synchronous SQLite interface supports the existing native driver and Node built-in SQLite. Drizzle remains the query layer.

### Canonical migration engine

The migration engine:

1. enumerates ordered SQL files;
2. computes SHA-256 for each file;
3. creates a canonical migration ledger;
4. bootstraps the legacy initial record;
5. applies missing migrations atomically;
6. rejects changed historical files;
7. preserves foreign-key behavior around migration boundaries.

### Process-level concurrency harness

Independent processes now prove:

- one lease winner;
- increasing fencing tokens;
- stale checkpoint rejection;
- one approval resolution;
- one outbox claim;
- publication restricted to the owner;
- bounded SQLite lock waiting.

### Recovery harness

A real seeded database is backed up, encrypted, restored to a clean path, and validated. The proof compares row counts and cryptographic hashes and verifies approval, receipt, and verification state.

### Atomic restore interruption

The restore operation exposes deterministic fault points for testing. Failure immediately after the old target is displaced must restore the original target.

## Failure-injection result

v14 passes **21 of 25** labeled scenarios.

Passed categories include:

- lease and checkpoint crashes;
- ambiguous side-effect reconciliation;
- approval restart;
- stale browser revision at the data contract level;
- approval expiry;
- database lock contention;
- outbox duplicate delivery;
- bounded timeout;
- malformed plan rejection;
- provider network loss;
- filesystem denial;
- simulated disk full;
- backup credential and integrity failure;
- restore interruption;
- stale process fencing;
- process-level approval continuation.

Blocked categories are browser tenant switching, browser offline behavior, browser accessibility/responsive behavior, and final verifier execution against the frozen archive.

## Test and build results

- Canonical validation: pass.
- English-only validation: pass.
- Source lint: pass.
- Migration validation: pass.
- TypeScript: pass.
- Release audit: pass.
- CI pin validation: pass.
- Static Roast: 43 of 44 controls pass.
- Dynamic Roast: 6 of 6 modes pass.
- Mutation probes: 12 of 12 killed.
- Complete tests: 49 files and 159 tests pass.
- Baseline evaluation: 8 of 8 pass.
- Durable crash proof: one side effect across two worker attempts.
- Production build: pass in 34 seconds with two workers.

## Security and sovereignty

No endpoint protection or managed browser policy was disabled. No opaque native binary was downloaded or executed on the protected host. The source release excludes database files, generated bindings, browser caches, build output, secrets, and local runtime data.

## Release decision

**DEVELOPMENT ONLY**

The correct next action is to run the frozen candidate in the pinned disposable browser lane, attach browser and accessibility evidence, and run the independent verifier against the exact final ZIP SHA-256. Unknown browser results remain blocking results.
