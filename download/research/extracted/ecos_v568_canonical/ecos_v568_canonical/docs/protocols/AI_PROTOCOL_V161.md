# AI Protocol — V161

## Immutable Rules for All ECOS Sessions

These rules apply from V161 forward. They accumulate — earlier rules remain in effect.

---

### R1 — Sacred Files Immutable

The following files **must never be modified**. Their MD5 checksums are canonical.

| File | MD5 |
|---|---|
| `lib/fiatLedger.js` | `563e9b1f9e67091a5b6527c0a92568e5` |
| `lib/auditLog.js`   | `e5a5c2c27801d2d03991bc8e5a1df8cb` |

**Verification (mandatory before packaging):**
```bash
md5sum lib/fiatLedger.js lib/auditLog.js
```
If either checksum differs from the above → **abort, do not package**.

---

### R2 — Endpoint Tagging

Every new endpoint appended to `ecos-api-server.js` must carry a comment tag of the form:

```
// ── [V{VERSION}-T{NN}] METHOD /path ─────
```

Tags are monotonically increasing within a version block. Never reuse or skip numbers within a version.

---

### R3 — Full Canonical ZIP

Each version must be delivered as a complete, self-contained ZIP archive named:

```
ecos_v{VERSION}_canonical.zip
```

Delta-only archives are never acceptable. The ZIP must include:
- `ecos-api-server.js`
- `lib/` (all modules including sacred files)
- `middleware/`
- `db/` (all migration SQL files)
- `tests/` (all test files)
- `apps/web/` (Next.js frontend — **must not be missing**)
- `package.json`
- `CHANGELOG_V{VERSION}.md`
- `NEXT_SESSION_PROMPT_V{VERSION}.md`
- `AI_PROTOCOL_V{VERSION}.md`

---

### R4 — No Endpoint Renumbering

Existing endpoint tags from prior versions (V158-T01 through V161-T36) must **never** be renumbered. New endpoints in V162+ begin at V162-T01.

---

### R5 — All Prior Tests Must Pass

Unit tests from all prior versions must continue to pass without modification. New services use isolated in-memory instances (`new ServiceClass()`) to prevent cross-test contamination.

---

### R6 — Zero New External Dependencies

No new npm packages may be introduced. Use only:
- Node.js built-ins: `crypto`, `fs`, `http`/`https`, `events`, `url`, `assert`, `path`, `net`
- Already-declared project packages: `pg`, `pino`, `ws`, `express`

---

### R7 — In-Memory + DB Dual Persistence

All new service modules must implement dual persistence:
1. **In-memory Map** (primary, always present) — for test isolation and zero-DB operation
2. **PostgreSQL `pg.Pool`** (secondary, optional) — enabled when `setDb(pool)` is called

The pattern is: write to in-memory Map first, then `try { await this._db.query(...) } catch (e) { this._log.warn(...) }`.

---

### R8 — Test-Mode Exports

Every new service module must include a conditional export block:

```js
if (process.env.NODE_ENV === 'test') {
  module.exports._serviceInstance = defaultServiceInstance;
  // ... export error classes, constants as needed
}
```

The main `ecos-api-server.js` must also export all new service instances in its test block.

---

### R9 — Handoff Docs Required

Every version must produce exactly three handoff documents:
- `CHANGELOG_V{VERSION}.md` — full changelog including metrics table
- `NEXT_SESSION_PROMPT_V{VERSION}.md` — continuation context for next AI session
- `AI_PROTOCOL_V{VERSION}.md` — this document (updated with any new rules)

---

### R10 — Doc Comments with Version Tags

Every new lib file must begin with a JSDoc block containing:
- Module name and version tag (e.g., `V161`)
- Purpose summary in Hebrew (for UI modules) or English
- List of exported classes and key methods
- Sacred files note: `// Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED`
- Version tag `[V161-TASK-NN]` for traceability

---

### R11 — apps/web Must Be Present (NEW in V161)

The `apps/web/` Next.js frontend must be included in every canonical ZIP. It was missing from V160 (size regression: 1.4MB → 1.2MB) and has been restored in V161 from the V157 canonical.

**Verification (mandatory before packaging):**
```bash
find apps/web/src -name "*.jsx" | wc -l  # must be ≥ 30
```

---

### R12 — Immutable Audit Trail (NEW in V161)

The `workspace_audit_trail` table is append-only at both the DB level (triggers prevent UPDATE/DELETE) and the service level (`WorkspaceAuditTrailService` has no modify/delete methods).

When adding audit logging to new endpoints, always call:
```js
await _auditTrail.record(workspaceId, 'event.type', { actorId, targetId, targetType, payload });
```

---

## Version Lineage

| Version | Phase | Sacred MD5 (fiat/audit) | Endpoints | Tests |
|---|---|---|---|---|
| V157 | P46 | 563e9b1f / e5a5c2c2 | ~58 | ~1,560 |
| V158 | P47 | 563e9b1f / e5a5c2c2 | ~72 | ≥1,608 |
| V159 | P48 | 563e9b1f / e5a5c2c2 | ~88 | ≥1,674 |
| V160 | P49 | 563e9b1f / e5a5c2c2 | 94  | ≥1,746 |
| **V161** | **P50** | **563e9b1f / e5a5c2c2** | **130** | **≥1,812** |
