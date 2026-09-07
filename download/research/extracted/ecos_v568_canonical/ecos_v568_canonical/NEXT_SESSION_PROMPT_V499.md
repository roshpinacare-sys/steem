# NEXT_SESSION_PROMPT_V499.md — Start of V500

## State at V499
- Version 499.0.0. New: `diamondGovernanceCycle499` — ONE bounded autonomous loop unifying economy +
  code-health → decide+cleanup → act through V437→V402→audit. Endpoint POST /api/v1/diamond/governance-cycle.
- Diamond arc complete: V453 operator · V462 foresight · V463/495/496 self-awareness · V497 cleanup ·
  V498 debt-vision · V499 unified governance cycle.
- Sacred intact; node --check clean; tests/v499.test.js green.
- KNOWN pre-existing broken suite: `inclusionProof.test.js` (fails on clean base too) — fix or quarantine.

## ⚠️ Pre-flight (do FIRST)
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v499.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
POST /api/v1/diamond/governance-cycle      # one unified cycle (propose mode)
```
- Sacred immutable; lib mirrors src/lib; suffix ids; R3/R6 no new npm deps; no nesting / no *-patch.js.

## High-leverage next (V500 — pick ONE)
1. **Flatten meshDispatcher (×10) — the real chain retirement.** Method (Diamond's own /cleanup-proposals
   describes it): create a self-contained `meshDispatcherFlat` exporting the UNION of all 288..297 exports
   (names are unique per version, no collisions), repoint the server's 10 requires to it, then thin-re-export
   288..296. Verify EVERY meshDispatcher-touching test + node --check + each /quorum endpoint still wires.
   Do it incrementally: union module first (verify), then repoint one require at a time.
2. **Fix or quarantine `inclusionProof.test.js`.**
3. **Diamond heartbeat:** opt-in periodic governance-cycle (propose-only) recorded to the audit log.

## Packaging
`ecos_v500_canonical.zip`, root `ecos_v500_canonical/`.
