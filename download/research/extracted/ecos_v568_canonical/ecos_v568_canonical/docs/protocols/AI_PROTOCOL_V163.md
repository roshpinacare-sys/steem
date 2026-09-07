# AI_PROTOCOL_V163.md
## Cross-Builder Communication Protocol — ECOS V163

---

## Protocol Rules

### R1 — Sacred File Immutability
```
lib/fiatLedger.js   MD5: 563e9b1f9e67091a5b6527c0a92568e5
lib/auditLog.js     MD5: e5a5c2c27801d2d03991bc8e5a1df8cb
```
Before packaging: `md5sum lib/fiatLedger.js lib/auditLog.js`

### R2 — Version Numbering
- package.json: `{major}.0.0`
- Endpoint labels: `[V{n}-T{nn}]` sequential
- Test files: `tests/v{n}FeatureName.test.js`
- DB migration: `db/migration_phase{n}.sql`

### R3 — Canonical ZIP Structure
Full canonical ZIP (not delta). All dirs included.

### R4 — Endpoint Continuity
Never renumber. New endpoints append only.

### R5 — Test Continuity
All prior tests pass. New version adds ≥ 40 tests.

### R6 — Zero External Deps Policy
No new npm packages without explicit user approval.

### R7 — In-Memory + DB Dual Persistence
All service classes: in-memory Map + DB try/catch.

### R8 — Export Block Pattern
`if (process.env.NODE_ENV === 'test') { module.exports._service = ... }`

### R9 — Handoff Documents Required
CHANGELOG_V{n}.md + NEXT_SESSION_PROMPT_V{n}.md + AI_PROTOCOL_V{n}.md

### R10 — Documentation Comments
JSDoc with version tag, task identifier, sacred files note.

### R12 — Audit Trail Append-Only
No modify/delete in audit service or DB.

---

## Version History

| Version | Phase | Endpoints | Tests  | DB Phase | Key Feature |
|---------|-------|-----------|--------|----------|-------------|
| V160    | P49   | 94        | ≥1,746 | 34       | RetryQueue + Dependencies + Quotas + Templates |
| V161    | P50   | 130       | ≥1,812 | 35       | Labels + Comments + SLA + AuditTrail |
| V162    | P51   | 145       | ≥1,878 | 36       | Recurrence + BulkOps + TimeTracking |
| V163    | P52   | 153       | ≥1,918 | 37       | CommentPin + SLA Assignee Report |

---

_AI_PROTOCOL_V163.md — ECOS Project — 2026-05-30_
