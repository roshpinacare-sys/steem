# Changelog — V497 — Dead-code cleanup (orphan archive) 🧹

**Release:** ECOS V497 · 2026-06-05 · AI lead (Opus 4.8)

## What was identified
The lib/ surface had grown to 640 modules. A corrected reference scan (accounting for both
`require('./x')` and `require('./x.js')` forms, and confirming the server uses NO dynamic
requires) found **62 true orphans** — modules required by ZERO files anywhere (server, tests,
other lib). Dead weight inflating the capability graph the registry and Diamond report on.

## What was done — decision-order rule A (clean irrelevant), done safely
- Archived the 62 orphans into `_archive_orphans_v497/` (MOVED, not deleted → fully reversible).
- lib/ 640 → 578 active modules; ~**19,623 dead lines** removed from the active surface.
- The 49 V495 thin re-exports that were also unreferenced were RESTORED (kept) so prior
  consolidation records stay intact — only genuinely dead standalone modules were archived.
- Added `orphanArchiveManifest497` + `_archive_orphans_v497/MANIFEST.json` so the system
  documents its own maintenance and the cleanup is queryable + reversible.

## Safety (verified, not assumed)
- Server `node --check` passes.
- **Zero** references to any archived module from the server or any remaining lib module.
- Registry families 418→388, capabilities 3573→2873 — a leaner, TRUTHFUL self-model
  (the graph now reflects only wired modules).
- Full node-assert suite: **40 pass, 1 fail** — the single failure (`inclusionProof.test.js`)
  is PRE-EXISTING (fails on clean v496 too), unrelated to this change.
- Sacred unchanged (R1). Zero new npm deps (R3/R6).

## Endpoints
- `GET /api/v1/admin/maintenance/v497` [T01] — the archive manifest (reversible record)
- `GET /api/v1/admin/summary/v497` [T02]

## Impact
A leaner, honest codebase: the registry/Diamond now reason over only the modules that are
actually wired. Nothing was lost — archived code is one move away from restoration.

## Breaking changes
None. Only unreferenced modules were moved; everything still resolves.
