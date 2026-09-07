# AI Protocol — V162

## Immutable Rules for All ECOS Sessions

These rules apply from V162 forward. They accumulate — earlier rules remain in effect.

---

### R1 — Sacred Files Immutable

| File | MD5 |
|---|---|
| `lib/fiatLedger.js` | `563e9b1f9e67091a5b6527c0a92568e5` |
| `lib/auditLog.js`   | `e5a5c2c27801d2d03991bc8e5a1df8cb` |

**Verification (mandatory before packaging):**
```bash
md5sum lib/fiatLedger.js lib/auditLog.js
```

---

### R2 — Endpoint Tagging

Every new endpoint appended to `ecos-api-server.js` must carry a comment tag of the form:
```
// ── [V{VERSION}-T{NN}] METHOD /path ─────
```
Tags are monotonically increasing within a version block.

---

### R3 — Full Canonical ZIP

Each version must be delivered as a complete, self-contained ZIP archive named:
```
ecos_v{VERSION}_canonical.zip
```
Must include all dirs: `ecos-api-server.js`, `lib/`, `middleware/`, `db/`, `tests/`, `apps/web/`, `package.json`, handoff docs.

---

### R4 — No Endpoint Renumbering

Existing endpoint tags from prior versions (V158-T01 through V162-T15) must **never** be renumbered. New endpoints in V163+ begin at V163-T01.

---

### R5 — All Prior Tests Must Pass

Unit tests from all prior versions must continue to pass without modification.

---

### R6 — Zero New External Dependencies

Use only Node.js built-ins and already-declared packages: `pg`, `pino`, `ws`, `express`.

---

### R7 — In-Memory + DB Dual Persistence

All new service modules implement dual persistence:
1. In-memory Map (primary)
2. PostgreSQL `pg.Pool` (secondary, optional via `setDb(pool)`)

---

### R8 — Test-Mode Exports

Every new service module must include:
```js
if (process.env.NODE_ENV === 'test') {
  module.exports._serviceInstance = defaultServiceInstance;
}
```

---

### R9 — Handoff Docs Required

Every version must produce exactly three handoff documents:
- `CHANGELOG_V{VERSION}.md`
- `NEXT_SESSION_PROMPT_V{VERSION}.md`
- `AI_PROTOCOL_V{VERSION}.md`

---

### R10 — Doc Comments with Version Tags

Every new lib file must begin with a JSDoc block containing module name, version tag, purpose, exports, and sacred files note.

---

### R11 — apps/web Must Be Present

```bash
find apps/web/src -name "*.jsx" | wc -l  # must be ≥ 30
```

---

### R12 — Immutable Audit Trail

`workspace_audit_trail` is append-only. No modify/delete methods.

---

## Version Lineage

| Version | Phase | Sacred MD5 (fiat/audit) | Endpoints | Tests |
|---|---|---|---|---|
| V157 | P46 | 563e9b1f / e5a5c2c2 | ~58 | ~1,560 |
| V158 | P47 | 563e9b1f / e5a5c2c2 | ~72 | ≥1,608 |
| V159 | P48 | 563e9b1f / e5a5c2c2 | ~88 | ≥1,674 |
| V160 | P49 | 563e9b1f / e5a5c2c2 | 94  | ≥1,746 |
| V161 | P50 | 563e9b1f / e5a5c2c2 | 130 | ≥1,812 |
| **V162** | **P51** | **563e9b1f / e5a5c2c2** | **145** | **≥1,878** |
