# CHANGELOG — V164

## Version: 164.0.0 | Phase: P53 | Date: 2026-05-30

---

## Summary

V164 implements **P1 high-value features** from the V163 roadmap:
1. **Comment Mentions + Notifications** — parse `@userId` in comment body, store mention records, list by comment/user, mark notified
2. **Enhanced Label Filtering** — `GET /tasks/by-labels?labelId[]=...` with AND logic multi-label filter + single-label task listing

---

## New Lib Modules (1)

| File | Lines | Purpose |
|---|---|---|
| `lib/workspaceCommentMentionService.js` | ~240 | Parse @mentions, record, list, mark notified |

---

## New DB Migration

**Phase 38** (`db/migration_phase38.sql`) — 1 new table + 1 new index:
- `workspace_comment_mentions` — mention records per comment
- `idx_wtl_workspace_label` — fast multi-label AND filter on workspace_task_labels

---

## New API Endpoints (8) — V164-T01 … V164-T08

### Block A — Comment Mentions (T01–T05)
| Tag | Method | Path |
|---|---|---|
| V164-T01 | POST | `/api/v1/workspaces/:id/tasks/:taskId/comments/:commentId/mentions` |
| V164-T02 | GET | `/api/v1/workspaces/:id/tasks/:taskId/comments/:commentId/mentions` |
| V164-T03 | GET | `/api/v1/workspaces/:id/members/:userId/mentions` |
| V164-T04 | PATCH | `/api/v1/workspaces/:id/mentions/:mentionId/notified` |
| V164-T05 | GET | `/api/v1/workspaces/:id/mentions/stats` |

### Block B — Enhanced Label Filtering (T06–T07)
| Tag | Method | Path |
|---|---|---|
| V164-T06 | GET | `/api/v1/workspaces/:id/tasks/by-labels?labelId[]=...` |
| V164-T07 | GET | `/api/v1/workspaces/:id/labels/:labelId/tasks` |

### Block C — Admin (T08)
| Tag | Method | Path |
|---|---|---|
| V164-T08 | GET | `/api/v1/admin/system/summary/v164` |

---

## Feature Details

### Comment Mentions
- `WorkspaceCommentMentionService.parseMentions(body)` — static regex parser: `/@([\w-]{1,64})/g`
- Deduplicates mentions per comment; skips self-mentions (author ≠ mentionee)
- In-memory Map + DB dual persistence
- Indexes: by `commentId`, by `workspaceId+userId`
- `recordMentions(workspaceId, taskId, commentId, body, authorId)` → `{ mentions, count }`
- `listByComment(workspaceId, commentId)` → `{ mentions, count }`
- `listForUser(workspaceId, userId, { limit })` → `{ mentions, count }`
- `markNotified(mentionId)` → `{ ok, mentionId }`

### Enhanced Label Filtering
- `GET /tasks/by-labels?labelId[]=lbl_1&labelId[]=lbl_2` — AND logic via GROUP BY + HAVING
- Returns only tasks with **all** specified labels (not OR)
- In-memory fallback via set intersection
- `GET /labels/:labelId/tasks` — single-label convenience endpoint

---

## Tests

| File | Tests | Status |
|---|---|---|
| `tests/v164.test.js` | 40 | ✓ PASS |
| `tests/v163.test.js` | 40 | ✓ PASS (regression) |

---

## Cumulative Metrics

| Metric | V163 | V164 |
|---|---|---|
| Server lines (`ecos-api-server.js`) | 12,161 | **12,424** |
| Total endpoints | 153 | **161** |
| Cumulative tests | ≥1,918 | **≥1,958** |
| DB migration phase | 37 | **38** |
| Total lib modules | ~50 | **~51** |

---

## Sacred Files

| File | MD5 | Status |
|---|---|---|
| `lib/fiatLedger.js` | `563e9b1f9e67091a5b6527c0a92568e5` | ✓ UNTOUCHED |
| `lib/auditLog.js` | `e5a5c2c27801d2d03991bc8e5a1df8cb` | ✓ UNTOUCHED |

---

## Protocol Compliance

- ✓ R1 — Sacred files untouched (MD5 verified)
- ✓ R2 — Endpoint tags V164-T01…T08 monotonically increasing
- ✓ R3 — Full canonical ZIP (all dirs included)
- ✓ R4 — No prior endpoints renumbered
- ✓ R5 — All V163 tests pass
- ✓ R6 — Zero new external dependencies
- ✓ R7 — In-memory + DB dual persistence in all new services
- ✓ R8 — NODE_ENV=test export blocks in new lib files
- ✓ R9 — Handoff docs: CHANGELOG + NEXT_SESSION_PROMPT + AI_PROTOCOL
- ✓ R10 — JSDoc blocks with version tags in all new lib files
- ✓ R12 — Audit trail append-only (unchanged)
