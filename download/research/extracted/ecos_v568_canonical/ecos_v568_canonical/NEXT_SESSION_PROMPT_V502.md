# NEXT_SESSION_PROMPT_V502.md — Start of V503

## State at V502 (audit/truth version — no feature)
- Version 502.0.0. Added `scripts/audit-tests.js` + `testAuditHarness502` + TEST_AUDIT.json +
  endpoint /api/v1/admin/test-audit/v502. Honest truth map: 46 pass / 72 cannotRun (vitest, offline) / 1 realFail.
- CORRECTED a real V497 regression: restored 11 test-referenced modules; manifest now truthful (51 archived).
- Sacred intact; node --check clean; tests/v502.test.js green.

## ⚠️ Pre-flight (do FIRST — and run the FULL audit, do not sample)
```
node scripts/audit-tests.js            # the whole truth: pass / cannotRun / realFail
node --check ecos-api-server.js
NODE_ENV=test node tests/v502.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```
- Sacred immutable; lib mirrors src/lib; suffix ids; R3/R6 no new npm deps; no nesting / no *-patch.js.
- HONESTY RULE: claim only what `scripts/audit-tests.js` shows. Never say "all green" — say "X/Y pass, Z cannotRun".

## Known open truths (not yet fixed)
1. **72 suites need vitest** — cannot run offline. If a session ever has network + vitest, run them; else report as unverified.
2. **v243.test.js** stale interim doc-check fails — quarantine or fix (do not delete to flatter numbers).
3. **51 modules archived** in _archive_orphans_v497/ — reversible; confirmed no code/test references.

## High-leverage next (V503 — pick ONE)
1. Make the cannotRun suites' STATUS explicit in-repo (a tests/README noting they need vitest), so no one mistakes them for passing.
2. Flatten meshDispatcher (×10) — the real chain retirement (recorded method in earlier prompts).
3. Surface the Diamond's posture to users in plain language (chat).

## Packaging
`ecos_v503_canonical.zip`, root `ecos_v503_canonical/`.
