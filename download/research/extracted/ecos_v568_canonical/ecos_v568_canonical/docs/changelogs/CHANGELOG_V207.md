# Changelog — V207 (Phase P96)

**Release:** ECOS V207 · 2026-05-30 · stabilized canonical build · AI lead

## Direction
V191→V206 added many small, isolated "event digest" endpoints. V207 introduces the
first **higher-order organizing layer**: a single self-map of the whole platform,
so the 50+ versioned feature blocks become one navigable catalog. This is the base
for a clean, chat-first "what can this system do?" surface.

## Stabilization (boss pass)
- `node --check` clean; no corruption; Sacred files unchanged (R1):
  fiatLedger.js `563e9b1f9e67091a5b6527c0a92568e5` · auditLog.js `e5a5c2c27801d2d03991bc8e5a1df8cb`.
- **Fixed a pre-existing regression:** `tests/v205.test.js` hardcoded `package.json === '205.0.0'`
  and had been FAILING since V206 shipped. Relaxed it (and v206) to `major >= N` (forward-compat).
  Full maintained chain is green again.

## Deliverables (`lib/systemCapabilities207.js`, loaded at top → R6-safe)
- **[V207-T01] `GET /api/v1/system/capabilities`** — navigable self-map: 12 curated
  domains (economy, audit, rank, notifications, workspaces, events, digest, broadcast,
  bookmarks, snapshots, tokens, admin), each with `since` version, maturity, summary,
  and surface list; plus rollups (totalDomains, totalSurfaces, byMaturity).
- **[V207-T02] `GET /api/v1/workspaces/:id/events/digest/burst?windowMs=&threshold=`**
  — pure sliding-window burst detection over the existing `_eventLog181`; adjacent
  qualifying windows merge into a single burst.
- **[V207-T03] `GET /api/v1/admin/summary/v207`**.

## Tests
`tests/v207.test.js` — 18 tests, all passing (capability rollups/sorting/integrity,
burst detection/merge/validation/defaults, R6 no-module-load guard, shared-export-block
regression guard, parse/corruption guard, version/docs/sacred).

## Conventions honored
R1 sacred immutable · R4 no endpoint removal · R5 full chain green · R6 zero new deps
(service loaded at top of file; V207 block adds no module loads) · R8 NODE_ENV=test
exports in the shared final block + version-suffixed identifiers (…207). No parallel stores.

## Breaking changes
None. Additive + read-only. No schema change.
