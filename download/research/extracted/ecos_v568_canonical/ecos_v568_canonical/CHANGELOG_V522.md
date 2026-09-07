# CHANGELOG V522 — Semantic Drift Recalibration

**Phase:** P383  **Date:** 2026-06-05  **Author:** AI engineering-partner
**Thesis:** *V521 turned 64+ blind suites into named pass/fail. V522 fixes the first one for real.*

---

## What changed (audit-first numbers — exit-code truth)

| Metric        | V521 (baseline) | V522 (this release) | Δ          |
|---------------|----------------:|--------------------:|-----------:|
| total suites  | 139             | 140                 | +1         |
| pass          | 103             | **105**             | **+2**     |
| cannotRun     | 24              | 24                  |  0         |
| realFail      | 12              | **11**              | **-1**     |
| SACRED md5    | unchanged       | unchanged           | 0          |
| new npm deps  | 0               | 0                   | 0          |

Numbers from `node scripts/audit-tests.js` on a fresh extract of the canonical zip.

## Fixed (real failure → real pass)

`tests/semanticDriftMonitor.test.js` — both inner failures resolved:

- `detects WARN on gradual downward velocity` — was reporting `NONE`, now `WARN`.
- `detects ALERT on accelerating downward trend (brittle — LEGAL)` — was reporting `WARN`, now `ALERT`.

Both were surfaced by the V521 vendored vitest shim. They are the first
*named* realFail from that batch to be turned into a real green.

## How (two constants + a connector)

1. `lib/semanticDriftMonitor.js` (and identical mirror `src/lib/semanticDriftMonitor.js`):
   - velocity-WARN gate: `-0.03` → `-0.015` — gradual ductile drift now surfaces.
   - acceleration-ALERT multiplier: `0.6` → `0.4` — modest brittle acceleration now escalates past WARN.
2. New connector `lib/semanticDriftFix522.js` (mirrored at `src/lib/`):
   - `getDriftThresholds522()` — reads the live constants back from source so the endpoint can't drift from reality.
   - `selfTest522()` — replays the exact two former-failing vectors *and* a stable-stays-NONE guard.
   - `registerEndpoints522(app)` — wires the V522 admin endpoints.
3. IIFE at the tail of `ecos-api-server.js` wires the connector. Fail-soft (warn-and-continue) on require failure.
4. `tests/v522.test.js` — pure-Node test, `exit 0` mandatory, 16 assertions including SACRED md5, parse, mirror equality, threshold values, self-test replay, fail-closed on missing `app`, and version assertion.

## Endpoints (additive — nothing removed)

- `GET /api/v1/admin/drift-fix/v522` — live thresholds + replay results.
- `GET /api/v1/admin/summary/v522` — V522 summary (version, phase, before/after, sacredUntouched flag).

## Untouched (per rules of engagement)

- SACRED: `lib/fiatLedger.js` (`563e9b1f9e67091a5b6527c0a92568e5`) and `lib/auditLog.js` (`e5a5c2c27801d2d03991bc8e5a1df8cb`) — md5 verified identical pre/post.
- Money: no `guardMint402`/`guardWithdraw402` path touched.
- Autonomy: Orchestrator (V437) untouched. No new agent-held keys.
- Existing endpoints: none removed, none renamed.
- No new npm dependencies (vendored source is fine — none added either).

## What was NOT verified (honest gap section)

These remain `realFail` after V522. Each is older than V522 and **none was caused by this release**; they're documented here so the next partner can pick one:

- `agent.test.js` — `require is not defined` inside ESM context. Needs `createRequire` or test rewrite.
- `chainProof.test.js`, `missionDashboard.test.js` — `Failed to parse URL from undefined/...` — tests expect a `TEST_BASE_URL` that isn't being set.
- `cli.test.js`, `monitor.test.js` — both import `../monitor/index.js` which **does not exist** in the repo. Either build the monitor (V89-P5 / V90-P3 / V95 spec is in the test header) or quarantine the tests with a skip-with-reason.
- `embeddingProvider.test.js`, `notification.test.js` — vitest-shim does not implement `toHaveBeenCalledOnce` / `resolves.not.toThrow`. Either widen the shim (V521 territory) or rewrite the assertions.
- `graduationEngine.test.js` — `expected undefined to be 1`. Likely a real product bug in graduation stage init.
- `paymentRail.test.js` — `Cannot find module '../lib/rails/manualRail'`. Either build the rail or remove the test.
- `stripe.test.js` — `Invalid API Key` against live Stripe SDK. Needs mock or skip.
- `v510.test.js` T08 — asserts realFail must be empty. Will only flip green when *all* of the above flip green.

`cannotRun = 24` is unchanged: those 24 suites need features the vendored shim does not yet implement (mocks beyond what V521 shipped, real network, etc.). Treated as honestly unknown, not as silent green.

## Next step recommendation

The cheapest next real fix is one of:
- `monitor/index.js` — a ~150-line plain-Node implementation against the test header in `tests/monitor.test.js` (would flip 2 realFails in one move).
- `embeddingProvider` / `notification` — extend the vitest-shim (`expect(...).toHaveBeenCalledOnce`, `expect(promise).resolves.not.toThrow`) to flip 2 more realFails without touching product code.

Either takes a 9th partner ~30 minutes and pushes `realFail` 11 → 9.
