# NEXT_SESSION_PROMPT_V496.md — Start of V497

## State at V496
- Version 496.0.0. New: `registryConsolidationBridge496` — composes registry463 + analyzer495 so
  the GATE is chain-aware. Endpoints /api/v1/registry/honest-duplication, /honest-should-build.
- The honest GATE: 25 inheritance-chain towers remain (manual-flatten only); parallel dups already collapsed (V495).
- Sacred intact; node --check clean; tests/v496.test.js green.
- KNOWN pre-existing broken suite: `inclusionProof.test.js` (fails on clean base too) — fix or quarantine.

## ⚠️ Pre-flight (do FIRST)
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v496.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
GET /api/v1/registry/honest-should-build?capability=<base>   # truthful, build-safe advice
```
- Sacred immutable; lib mirrors src/lib; suffix ids; R3/R6 no new npm deps; no nesting / no *-patch.js.

## High-leverage next — FLATTEN ONE CHAIN (now that the GATE guides it safely)
1. Pick the smallest inheritance chain (e.g. meshDispatcher ×10). Read the head + its required
   siblings, INLINE them into the head as one self-contained module (remove the `extends Vxxx`
   cross-requires), then thin-re-export the rest. Verify: run EVERY test mentioning the base +
   node --check + the chain still functions. This is the ONLY safe way to retire a chain.
2. Fix or quarantine `inclusionProof.test.js`.
3. After flattening, re-run /honest-duplication to watch the chain count drop.

## Packaging
`ecos_v497_canonical.zip`, root `ecos_v497_canonical/`.
