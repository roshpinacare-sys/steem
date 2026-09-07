# Changelog — V496 — Registry↔Analyzer Bridge 🌉 (the GATE finally tells the truth)

**Release:** ECOS V496 · 2026-06-04 · AI lead (Opus 4.8)

## Why (connection > addition)
Two of our own modules were disconnected and contradicting each other:
- **V463 registry** — the GATE every agent is told to consult — still reported the NAIVE
  retirable count (~188), counting inheritance chains as collapsible.
- **V495 analyzer** — knew the truth (chains break on naive re-export) but wasn't wired in.
So an agent consulting the GATE would attempt to collapse a chain and BREAK THE BUILD
(exactly what happened in the V495 investigation). V496 bridges them — no new capability,
just the connection that makes the existing advice safe.

## Feature — `registryConsolidationBridge496` (src/lib + lib mirror)
- **honestDuplication496** — every V463 tower classified by V495: `inheritance-chain` vs
  `parallel-duplicate`, with the naive count AND the honest (safe) retirable count side by side.
- **honestShouldBuild496** — the V463 verdict PLUS a safety classification: a `consolidate`
  recommendation now carries `method: manual-flatten` (chains) or `thin-re-export` (parallels),
  `collapseSafeNow`, and explicit guidance so no agent breaks the build.

## Measured at build time
V463 naive: ~188 retirable. **Honest: 0 naively-safe** right now (the parallel duplicates were
already collapsed in V495; the remaining 25 towers are inheritance chains requiring manual
flatten). The GATE for marketMaker now returns consolidate + manual-flatten + "do NOT thin-re-export".

## Endpoints
- `GET /api/v1/registry/honest-duplication` [T01]
- `GET /api/v1/registry/honest-should-build?capability=...` [T02]
- `GET /api/v1/admin/summary/v496` [T03]

## Verification
- `node --check` clean; `tests/v496.test.js` all pass — honest<=naive, chains excluded from
  safe retirable, manual-flatten guidance for chains, build_new for novel, wiring, reuse-not-reinvent.
- Sacred unchanged (R1). Zero new npm deps (R3/R6).

## Impact (affects everyone)
The single source of consolidation advice — the GATE in the canonical prompt — is now truthful
and build-safe. Future agents get chain-aware guidance and stop breaking the build.

## Breaking changes
None. Additive bridge over existing modules.
