# NEXT_SESSION_PROMPT_V495.md — Start of V496

## State at V495
- Version 495.0.0. New: `consolidationAnalyzer495` — classifies towers chain-vs-parallel,
  honest retirable count. EXECUTED: 113 parallel-duplicate modules collapsed to thin
  re-exports (verified safe). Endpoints /api/v1/registry/consolidation-safety.
- Sacred intact; node --check clean; tests/v495.test.js green.
- NOTE: pre-existing broken suite `inclusionProof.test.js` (fails on clean v494 too) — fix or quarantine.

## ⚠️ Pre-flight (do FIRST)
```
node --check ecos-api-server.js
NODE_ENV=test node tests/v495.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
GET /api/v1/registry/consolidation-safety  # the honest plan
```
- Sacred immutable; lib mirrors src/lib; suffix ids by version; R3/R6 no new npm deps.
- NO nesting, NO *-patch.js. Integrate INTO the server via the EOF IIFE; verify by exit code.

## High-leverage next (keep consolidating — SAFELY)
1. **Flatten ONE inheritance chain** (start with the smallest, e.g. meshDispatcher ×10): inline the
   chain into the head as a single self-contained module, then thin-re-export the rest. Verify by
   running every test that mentions the base + node --check. This is the only safe way to retire a chain.
2. **Fix or quarantine `inclusionProof.test.js`** (pre-existing failure) so the suite is green.
3. **Wire consolidation-safety into the registry GATE** (V463 should call analyzer495 so should-build
   reflects the honest chain-vs-parallel truth).
4. Continue collapsing any NEW parallel duplicates agents added.

## Packaging
`ecos_v496_canonical.zip`, root `ecos_v496_canonical/`.
