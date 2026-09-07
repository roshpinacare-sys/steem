# TITAI v12 Honest Limitations

## Independently verified

None. The same execution environment performed implementation and local testing. The system now supports hash-bound verifier attestations, but no separately operated verifier has signed the final package.

## Implemented and tested

- Fencing-token lease protection and stale-worker rejection.
- Step-level durable recovery for deterministic simulation/dry-run workflows.
- Approval compare-and-set revisions and stale-client conflict response.
- Verification-aware model routing and unavailable-model rejection.
- Governed-memory quarantine, contradiction handling, provenance, and ablation tests.
- Risk-adjusted tool autonomy and bounded tool execution.
- Immutable verification-attestation contracts and visible verification UI.
- Conservative pilot-readiness gate.
- Dynamic Roast, property/race probes, source accessibility contracts, and curated mutation probes.

## Partially implemented

- Active runner cutover: guarded simulation/dry-run step durability exists; live-provider continuation does not.
- Authorization: owner-scoped controls exist; full tenant/workspace model is incomplete.
- Approval restart: approval state is persisted, but the provider conversation cannot be reconstructed.
- Verification: evidence binding exists, but tests are not automatically executed by a separate verifier service.
- Design: product code and deterministic visual evidence exist, but browser behavior is not proven here.

## Environment blocked

- Three native SQLite suites cannot load because `better_sqlite3.node` is absent after safe `npm ci --ignore-scripts` installation.
- Production build compiled and passed Next.js type validation, but page-data collection exceeded the bounded execution window and was terminated.
- Chromium screenshot/E2E execution times out because the container lacks required kernel/DBus capabilities.
- Browser accessibility and visual-regression gates could not run.

## Open

- Drizzle ORM upgrade and full validation of the acquired real package.
- Live-provider restart continuation and side-effect reconciliation.
- Multi-process SQLite lease/approval race verification.
- Complete tenant/workspace isolation.
- Strong process/container tool sandboxing.
- Independent external audit anchoring.

## Release classification

**DEVELOPMENT ONLY.** The package is not safe for a controlled pilot until the native, build, browser, accessibility, live-restart, and independent-verification gates pass.
