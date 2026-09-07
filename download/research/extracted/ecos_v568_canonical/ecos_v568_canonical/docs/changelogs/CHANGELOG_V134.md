# ECOS Changelog — V134: Rank Integration & Persistence

**Release Date:** 2026-05-30
**Version:** 134.0.0
**Release Name:** Rank Integration & Persistence (P24)

---

## Overview

V134 delivers P24 — the full integration of the V133 rank system into the live
activity flow and data persistence layer. Rank is now earned automatically from
real actions, stored in Postgres, gated at API endpoints, and the communication
channel subscription system is operational.

---

## Deliverables

### [V134-RI-01] Rank Events Wired from Existing Activity

Rank score events are now auto-recorded when real activity happens:

| Activity | User scored | Event | Points |
|----------|-------------|-------|--------|
| Task created | Client (`clientAccountId`) | `task_submitted` | +10 |
| Approval resolved (validator) | Validator | `validation_completed` | +20 |
| Approval APPROVE decision | Validator | `validation_correct` | +15 |
| Approval APPROVE decision | Client | `task_approved` | +25 |
| Royalty paid for patch | Patch author (validator) | `patch_earning_royalty` | +50 |

All event wiring is non-fatal (`try/catch`) — a rank failure never breaks a
financial transaction.

### [V134-RI-02] DB Persistence for Rank Scores

**New DB tables** (`db/migration_phase17.sql`):
- `rank_scores` — persistent score per user (upserted on every event)
- `rank_events` — immutable audit log of every score delta
- `rank_tier_changes` — subset log: promotions and demotions only

**`UserRankSystem` changes:**
- Constructor accepts `opts.dbPool` (optional)
- `async loadFromDb()` — loads rank scores from DB on startup (non-fatal fallback)
- `_persistToDb(...)` — fire-and-forget upsert on every `recordEvent()` call
- Server startup: `defaultUserRankSystem._db` wired after DB connects; `loadFromDb()` called

### [V134-RI-03] Rank-Gated Reward Distribution

`POST /api/v1/distribute` now reads the validator's rank profile before
distributing. The `rankMultiplier` and `rankTier` are passed as metadata on the
`distributeTaskPayment` call. Validators below `CONTRIBUTOR` tier are logged as
reward-withheld (future billing iteration can enforce hard block here).

Multipliers by tier:
| Tier | Multiplier | Eligible |
|------|------------|---------|
| OBSERVER | 0× | ✗ |
| MEMBER | 0× | ✗ |
| CONTRIBUTOR | 1× | ✓ |
| VALIDATOR | 1.5× | ✓ |
| STEWARD | 2× | ✓ |
| SOVEREIGN | 3× | ✓ |

### [V134-RI-04] Rank-Gated API Middleware

**New:** `middleware/requireRank.js`
- `requireRank(rankSystem, minTier)` — returns a synchronous gate function
- `gate(userId)` → `{ ok, error?, code?, required?, current?, profile? }`
- Error codes: `NO_USER_ID`, `RANK_INSUFFICIENT`
- Used on `GET /api/v1/rank/premium` (CONTRIBUTOR+) as reference implementation

### [V134-RI-05] Communication Channel Subscription System

**New:** `lib/commChannelSystem.js`
- 6 channels matching tier access levels
- Rank-gated subscribe: user must have `commLevel >= channel.minLevel`
- Idempotent subscribe (second call returns `alreadySubscribed: true`)
- In-memory store with optional DB persistence hook (`comm_subscriptions` table)

**New API endpoints (5):**

| Method | Path | Description |
|--------|------|-------------|
| GET  | `/api/v1/comm/channels`                       | Accessible channels for userId (with subscription status) |
| GET  | `/api/v1/comm/channels/list`                  | All channel definitions (no auth) |
| GET  | `/api/v1/comm/stats`                          | System-wide subscription stats |
| POST | `/api/v1/comm/channels/:id/subscribe`         | Rank-gated subscribe |
| POST | `/api/v1/comm/channels/:id/unsubscribe`       | Unsubscribe |
| GET  | `/api/v1/comm/users/:userId/subscriptions`    | User's subscriptions + accessible channels |

---

## New Files

| File | Purpose |
|------|---------|
| `db/migration_phase17.sql` | rank_scores, rank_events, rank_tier_changes tables |
| `middleware/requireRank.js` | Rank-gated endpoint middleware |
| `lib/commChannelSystem.js` | Communication channel subscription system |
| `tests/v134RankIntegration.test.js` | ~40 tests for all 5 deliverables |
| `docs/CHANGELOG_V134.md` | This file |
| `MIGRATION_NOTES_V134.md` | Upgrade guide |

---

## Invariants Preserved

1. ✅ `lib/fiatLedger.js` — NOT modified (sacred, MD5 unchanged)
2. ✅ `lib/auditLog.js`  — NOT modified (sacred, MD5 unchanged)
3. ✅ BigInt-only accounting (rank system uses integer scores, not BigInt — separate domain)
4. ✅ No new npm dependencies
5. ✅ All V133 endpoints preserved
6. ✅ Rank event failures are non-fatal (never break financial transactions)

---

## Tests

| File | Tests |
|------|-------|
| `tests/v134RankIntegration.test.js` | ~40 |

**Expected total: ~1313 passing** (V133: ~1273 + V134: ~40)
