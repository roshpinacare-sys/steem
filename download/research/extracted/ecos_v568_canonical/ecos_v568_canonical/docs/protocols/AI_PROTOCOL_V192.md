# AI_PROTOCOL_V192.md — ECOS V192 (Phase P81)

Extends AI_PROTOCOL_V191.md. All prior rules (R1–R8) remain in force.

## Invariants carried forward

| Rule | Summary |
|------|---------|
| R1 | Sacred files immutable: `lib/fiatLedger.js` MD5 `563e9b1f…` · `lib/auditLog.js` MD5 `e5a5c2c2…` |
| R4 | Never remove endpoints |
| R5 | All prior test suites must pass |
| R6 | Zero new npm dependencies |
| R8 | `NODE_ENV=test` export block; version-suffixed identifiers (BUG-L guard) |

## Chain notes for V193+

- Event digest service: `_eventDigest191` (singleton, `WorkspaceEventDigestService191`).
- Event log store: `_eventLog181` (ring-buffer Map, workspace → array).
- Bookmarks: `_bookmarks184`. Snapshots: `_statsSnapshots185`. Tokens: `_tokenSvc181`.
- Broadcast: `_broadcast179`.
- V192 added two read-only digest views (window + by-sender). No new stores were introduced.
- Any further digest work MUST read `_eventLog181`; do NOT create a parallel events store.

## Version lineage (recent)

| Version | Phase | Endpoints added | Tests |
|---------|-------|----------------|-------|
| V189 | P78 | 4 | 61 |
| V190 | P79 | 4 | 61 |
| V191 | P80 | 2 | 14 |
| **V192** | **P81** | **3** | **21** |
