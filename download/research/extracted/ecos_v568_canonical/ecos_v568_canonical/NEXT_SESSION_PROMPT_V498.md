# NEXT_SESSION_PROMPT_V498.md — Start of V499

## State at V498
- Version 498.0.0. New: `diamondCodeHealthSignal498` — connects bridge496 + manifest497 into the
  Diamond's cognition (technical debt as a bounded signal) + the Diamond proposes its own cleanup.
  Endpoints /api/v1/diamond/code-health, /cognition-augmented, /cleanup-proposals.
- Diamond stack now: V453 operator + V462 foresight + V463/495/496 self-awareness + V497 cleanup + V498 debt-vision.
- Sacred intact; node --check clean; tests/v498.test.js green.
- KNOWN pre-existing broken suite: `inclusionProof.test.js` (fails on clean base too) — fix or quarantine.

## ⚠️ Pre-flight (do FIRST)
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v498.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
GET /api/v1/diamond/cognition-augmented    # economy + code-health in one view
```
- Sacred immutable; lib mirrors src/lib; suffix ids; R3/R6 no new npm deps; no nesting / no *-patch.js.

## High-leverage next
1. **THE real consolidation win — flatten meshDispatcher (×10):** the server pins D288..D297 with
   version-specific exports. Build a self-contained `meshDispatcherFlat` head exporting the UNION of
   all version exports, repoint the server's requires to it, then thin-re-export 288..296. Verify
   EVERY meshDispatcher-touching test + node --check. The Diamond's /cleanup-proposals already
   describes this exact method. This is the first real chain retirement.
2. **Fix or quarantine `inclusionProof.test.js`.**
3. **Close the Diamond's loop:** let actAutonomously453 consume proposeCleanup498 proposals (propose-only)
   so the operator surfaces cleanup in its normal decision cycle + audit log.

## Packaging
`ecos_v499_canonical.zip`, root `ecos_v499_canonical/`.
