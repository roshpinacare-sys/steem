# NEXT_SESSION_PROMPT_V497.md — Start of V498

## State at V497
- Version 497.0.0. Cleanup: 62 true orphans archived to _archive_orphans_v497/ (reversible).
  lib 640→578, ~19.6k dead lines off the active surface. Manifest at /api/v1/admin/maintenance/v497.
- Registry/Diamond self-model is now truthful (families 418→388).
- Sacred intact; node --check clean; tests/v497.test.js green; full node-assert suite 40 pass / 1 pre-existing fail.
- KNOWN pre-existing broken suite: `inclusionProof.test.js` (fails on clean base too) — fix or quarantine.

## ⚠️ Pre-flight (do FIRST)
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v497.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
GET /api/v1/registry/honest-should-build?capability=<base>   # truthful, build-safe advice
```
- Sacred immutable; lib mirrors src/lib; suffix ids; R3/R6 no new npm deps; no nesting / no *-patch.js.

## High-leverage next
1. **More safe cleanup:** re-run the corrected orphan scan after any new additions; archive new true orphans.
   Consider archiving the 26 stale top-level *-patch.js files if confirmed unreferenced.
2. **Flatten ONE inheritance chain (the hard, real win):** meshDispatcher ×10 — BUT the server pins
   version-specific exports (D288..D297). Safe path: build a self-contained head exporting the UNION of
   all version exports, point the server's requires at it, then thin-re-export the rest. Verify every
   meshDispatcher-touching test + node --check. Use /registry/honest-should-build to confirm method.
3. **Fix or quarantine `inclusionProof.test.js`.**
4. **Connect code-health into the Diamond:** feed honestDuplication496 (chains, orphans) into
   assessSystem453 as a technical-debt signal so the autonomous operator proposes cleanup itself.

## Packaging
`ecos_v498_canonical.zip`, root `ecos_v498_canonical/`.
