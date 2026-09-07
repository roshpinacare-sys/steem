# Changelog — V172 (Phase P61)

**Release:** ECOS V172 · 2026-05-30
**Phase:** P61 — Workspace Search (+ critical server restore)

## ⚠️ BUG-L (CRITICAL) — server was unbootable since V169
`ecos-api-server.js` failed to parse: the V169 block re-`require`d a parallel
recurrence module (`lib/taskRecurrenceService.js`) and re-declared two `const`
identifiers already bound by the earlier V162 block —
`RecurrenceNotFoundError` and `_recurrence` — causing
`SyntaxError: Identifier '...' has already been declared`. The server (and every
endpoint) could not start in V169, V170, or V171.

**Fix (minimal, behaviour-preserving):**
- Dropped the duplicate `RecurrenceNotFoundError` binding from the V169 require
  (it was unused in V169 handler bodies).
- Renamed the V169 recurrence instance and its references to `_recurrence169`
  (the earlier V162 `_recurrence` is untouched and still serves V162 routes).
`node --check` now passes; a `vm.Script` parse assertion guards against regress.

> Note: V162-T01 and V169-T01 register the same recurrence route; Express uses
> the first (V162). De-duplicating the two recurrence subsystems is deferred to
> V173 (see NEXT_SESSION_PROMPT_V172.md) to keep this fix low-risk.

## Deliverable — Workspace Search (`lib/workspaceSearchService.js`)
Full-text-ish search across tasks (and tags/comments when their providers are
available). Decoupled via injected async providers → pure and unit-testable.
Case-insensitive substring matching with relevance scoring (exact 100 / prefix
50 / substring 20 / body 10), type filtering, snippets, and pagination.

- `GET /api/v1/workspaces/:workspaceId/search?q=&types=&limit=&offset=`  `[V172-T01]`
- `GET /api/v1/admin/summary/v172`                                       `[V172-T02]`

## Tests
`tests/v172.test.js` — 18 tests, all passing (scoring/snippets/type-filter/
pagination/validation + BUG-L parse guard + server wiring + version/docs).

## Sacred Files (R1 — verified unchanged)
- `lib/fiatLedger.js`  MD5: 563e9b1f9e67091a5b6527c0a92568e5
- `lib/auditLog.js`    MD5: e5a5c2c27801d2d03991bc8e5a1df8cb

## Breaking changes
None. All prior endpoints/tests preserved (R4, R5). Search is additive; no schema
change required (searches live task/label data).
