# TITAI v13 Controlled Pilot Addendum

## Scope

This addendum records pilot-convergence findings discovered while converting the bounded local artifact workflow into a tenant-scoped, restart-oriented, evidence-backed path.

## Confirmed Improvements

- Tenant, workspace, ownership, and visibility are persisted on pilot resources.
- Approval continuation uses a deterministic key, revision compare-and-set, expiry, and a durable checkpoint.
- Lease fencing prevents stale workers from committing after takeover.
- Pilot Readiness is derived from live evidence and treats unknown evidence as blocking.
- Database creation is lazy, so Next.js can complete a production source build without opening SQLite during route discovery.
- A pinned, least-privilege CI lane defines native SQLite, browser, accessibility, and multi-process validation without modifying the protected host.

## Confirmed Blockers

- Native SQLite integration suites cannot collect locally because the `better_sqlite3.node` binding is intentionally absent.
- Local browser E2E cannot launch because Playwright browser executables are intentionally not downloaded on the protected host.
- Fifteen of twenty-five failure scenarios require native persistence, browser, operating-system, or live-provider execution in the isolated lane.
- Final independent verification must reject the candidate until the isolated-lane evidence is attached and bound to the final archive hash.

## Release Effect

The package remains `DEVELOPMENT ONLY`. The selected pilot is narrower, more testable, and closer to an internal pilot, but the release gates are intentionally fail-closed.
