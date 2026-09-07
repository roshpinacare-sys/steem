# Changelog — V176 (Phase P65)

**Release:** ECOS V176 · 2026-05-30
**Phase:** P65 — Task Watcher Service · Workspace Member Service · Per-Workspace Rate Limiter

---

## Summary

V176 delivers three new service-layer modules (P1 items from NEXT_SESSION_PROMPT_V175) that
bring proper in-memory + optional DB persistence to areas that were previously either DB-only
(task watchers, V159) or missing a testable service layer entirely (workspace members, rate
limiting).

All prior endpoints and tests are preserved (R4, R5). Zero new npm dependencies (R6).

---

## New Features

### 1. Task Watcher Service — `lib/taskWatcherService.js` [V176-T01 … V176-T04]

A dedicated service layer for task subscription management, replacing the DB-only V159 watcher
routes with a fully testable in-memory store (Map) plus optional DB write-through.

**API:**
- `watch(taskId, workspaceId, userId)` — idempotent; returns `{ watcher, created }`
- `unwatch(taskId, userId)` — idempotent; returns `{ removed }`
- `listWatchers(taskId)` — all watchers for a task
- `listWatchedTasks(userId, { workspaceId? })` — all tasks watched by a user
- `isWatching(taskId, userId)` — boolean check
- `stats()` — aggregate counts

**New endpoints:**

| Tag | Method | Path | Description |
|-----|--------|------|-------------|
| V176-T01 | POST | `/api/v1/workspaces/:id/tasks/:taskId/watchers` | Add watcher (idempotent, 201/200) |
| V176-T02 | DELETE | `/api/v1/workspaces/:id/tasks/:taskId/watchers` | Remove watcher (`?userId=`) |
| V176-T03 | GET | `/api/v1/workspaces/:id/tasks/:taskId/watchers/v2` | List watchers (service-backed) |
| V176-T04 | GET | `/api/v1/workspaces/:id/watchers/by-user/:userId` | Tasks watched by user |

> Note: V159-T31/T32/T33 (DB-only watcher routes) are preserved and untouched (R4).
> V176-T03 uses the `/watchers/v2` suffix to avoid route collision with V159-T33.

---

### 2. Workspace Member Service — `lib/workspaceMemberService.js` [V176-T05 … V176-T09]

A proper service layer for workspace membership with roles, replacing the DB-only V158 member
routes. Supports in-memory store + optional DB write-through. Upsert semantics on `addMember`.

**Roles:** `owner | admin | member | viewer`

**API:**
- `addMember(workspaceId, userId, { role?, addedBy? })` — upsert semantics
- `getMember(workspaceId, userId)` — throws `MemberNotFoundError` if absent
- `listMembers(workspaceId, { role? })` — optional role filter
- `updateRole(workspaceId, userId, newRole)` — throws `MemberNotFoundError` / `MemberValidationError`
- `removeMember(workspaceId, userId)` — idempotent
- `stats()` — aggregate counts + role breakdown

**New endpoints:**

| Tag | Method | Path | Description |
|-----|--------|------|-------------|
| V176-T05 | POST | `/api/v1/workspaces/:id/members/v2` | Add/upsert member (201/200) |
| V176-T06 | GET | `/api/v1/workspaces/:id/members/v2` | List members (`?role=` filter) |
| V176-T07 | GET | `/api/v1/workspaces/:id/members/v2/:userId` | Get single member |
| V176-T08 | PATCH | `/api/v1/workspaces/:id/members/v2/:userId/role` | Update role |
| V176-T09 | DELETE | `/api/v1/workspaces/:id/members/v2/:userId` | Remove member |

> Note: V158-T16/T17/T18 (DB-only member routes) are preserved and untouched (R4).
> V176 endpoints use the `/members/v2` prefix to avoid route collision.

---

### 3. Per-Workspace Rate Limiter — `lib/workspaceRateLimiterService.js` [V176-T10 … V176-T12]

An in-memory token bucket rate limiter with one bucket per workspace. Configurable capacity,
refill rate, and refill window. Automatic cleanup of stale buckets (10 min idle). Zero external
dependencies (R6).

**Algorithm:** Token bucket — each workspace starts with `capacity` tokens; each request
consumes one token; tokens refill at `refillRate` per `refillWindowMs`.

**API:**
- `check(workspaceId, opts?)` — consume one token; returns `{ allowed, remaining, resetAt, workspaceId }`
- `getBucketStats(workspaceId)` — snapshot of a single bucket (null if not yet seen)
- `stats()` — aggregate across all active buckets

**New endpoints:**

| Tag | Method | Path | Description |
|-----|--------|------|-------------|
| V176-T10 | GET | `/api/v1/admin/rate-limits` | Aggregate stats for all active buckets |
| V176-T11 | GET | `/api/v1/admin/rate-limits/:workspaceId` | Stats for a specific workspace bucket |
| V176-T12 | GET | `/api/v1/admin/summary/v176` | V176 admin summary |

**Defaults:** capacity=60, refillRate=60 tokens/min, refillWindow=60s.

---

## Infrastructure Fixes

### vendor/nanoid — Pure-JS vendored module

The `vendor/nanoid` directory was missing from V175 canonical ZIP, causing the smoke tests to
fail. A pure-JS implementation has been added:

- `vendor/nanoid/index.js` — implements `nanoid(size)` and `customAlphabet(alphabet, size)`
  using `crypto.getRandomValues` (Node.js built-in), zero external dependencies.
- `vendor/nanoid/package.json` — enables `require('../vendor/nanoid')` resolution.

### src/lib symlink

The smoke tests reference `../src/lib/fiatLedger` and `../src/lib/hitlGate`, but the canonical
files live in `lib/`. A `src/lib` → `../lib` symlink resolves this without moving files.

---

## Tests

`tests/v176.test.js` — **81 tests, all passing**

| Section | Tests |
|---------|-------|
| Server parse + structure | 4 |
| Server source guards | 18 |
| TaskWatcherService unit | 17 |
| WorkspaceMemberService unit | 22 |
| WorkspaceRateLimiterService unit | 17 |
| New lib files exist | 3 |

---

## Sacred Files (R1 — verified unchanged)

| File | MD5 |
|------|-----|
| `lib/fiatLedger.js` | `563e9b1f9e67091a5b6527c0a92568e5` ✓ UNCHANGED |
| `lib/auditLog.js` | `e5a5c2c27801d2d03991bc8e5a1df8cb` ✓ UNCHANGED |

---

## Breaking Changes

None. All prior endpoints and tests preserved (R4, R5). New endpoints use `/v2` suffix or new
paths to avoid any route collision.

---

## New Files

| File | Description |
|------|-------------|
| `lib/taskWatcherService.js` | Task watcher in-memory + DB service |
| `lib/workspaceMemberService.js` | Workspace member registry with roles |
| `lib/workspaceRateLimiterService.js` | Per-workspace token bucket rate limiter |
| `vendor/nanoid/index.js` | Pure-JS vendored nanoid |
| `vendor/nanoid/package.json` | nanoid package descriptor |
| `tests/v176.test.js` | 81-test V176 suite |
| `CHANGELOG_V176.md` | This file |
| `NEXT_SESSION_PROMPT_V176.md` | Handoff for next session |
