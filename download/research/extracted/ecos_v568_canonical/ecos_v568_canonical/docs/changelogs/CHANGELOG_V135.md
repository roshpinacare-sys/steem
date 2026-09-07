# ECOS Changelog — V135: Rank Hardening & Reward Enforcement

**Release Date:** 2026-05-30
**Version:** 135.0.0
**Release Name:** Rank Hardening & Reward Enforcement (P25)

---

## Overview

V135 delivers P25 — hardening the V133/V134 rank system from "soft logging" into
real enforcement, and wiring rank events into two previously untracked activity types:
referral conversions and streak milestones. The CommChannels frontend page makes
rank-gated subscriptions accessible from the web UI.

---

## Deliverables

### [V135-RH-01] Hard Reward Enforcement

**Before (V134):** Validators below CONTRIBUTOR had their distribute share logged as
"withheld" but the ledger still credited them (no financial effect).

**After (V135):** A second `ledger.transfer(validatorAccountId → sys::insurance_pool)`
is executed immediately after `distributeTaskPayment()` for ineligible validators.
The full amount is redirected to the insurance pool and recorded in the audit chain.

- `lib/fiatLedger.js` is NOT modified (sacred).
- The enforcement is a standard post-distribute transfer, fully audited.
- Wrapped in try/catch — non-fatal if account has zero balance or other edge case.
- API response now includes `hardEnforcementNote: { withheld, redirectedTo }` when triggered.

Multiplier table (unchanged from V134):
| Tier | Eligible | Multiplier |
|------|----------|-----------|
| OBSERVER | ✗ | 0× → redirected to insurance |
| MEMBER | ✗ | 0× → redirected to insurance |
| CONTRIBUTOR | ✓ | 1× |
| VALIDATOR | ✓ | 1.5× |
| STEWARD | ✓ | 2× |
| SOVEREIGN | ✓ | 3× |

### [V135-RH-02] `comm_subscriptions` DB Table

`CommChannelSystem` (V134) already wrote to `comm_subscriptions` — but the table
was never created in a migration. This release adds `db/migration_phase18.sql`:

- `comm_subscriptions (user_id, channel_id, subscribed_at)` — composite PK,
  idempotent subscribe (ON CONFLICT DO NOTHING already in V134 code).
- `streak_events (user_id, milestone, streak_value)` — UNIQUE index on
  `(user_id, milestone)` prevents double-firing streak rank events on server restart.

### [V135-RH-03] `referral_converted` Rank Event

When a referee completes their first real action (task or validation), the referral bonus
is unlocked. V135 now also fires a `referral_converted` rank event (+40 pts) for both the
referee and the referrer at that moment.

**Wiring:**
- `lib/userAccount.js` — `recordActivity()` calls `this._rankSystem.recordEvent()` for both users.
- `_rankSystem` is wired inside the `_v111` IIFE in `ecos-api-server.js` via
  `require('./lib/userRankSystem')` (avoids circular dependency).
- Non-fatal: wrapped in try/catch.

### [V135-RH-04] Streak Milestone Rank Events

`updateStreak()` in `lib/engagementEngine.js` now fires rank events when a user's
current streak crosses 7 or 30 consecutive days:

| Milestone | Event | Points |
|-----------|-------|--------|
| 7 days | `streak_7d` | +20 |
| 30 days | `streak_30d` | +60 |

**Double dedup strategy** (prevents double-firing on server restart):
1. In-memory `_streakMilestoneFired` Map — instant dedup within a server process.
2. DB `streak_events` upsert with `ON CONFLICT (user_id, milestone) DO NOTHING` —
   survives restart.

`_rankSystem` and `_db` are set externally after init (startup wiring in `ecos-api-server.js`).

### [V135-RH-05] CommChannels Frontend Page

New page: `apps/web/src/app/comm/page.jsx`

Features:
- All 6 channel definitions listed with tier requirement badge and subscriber count.
- User ID input → loads accessible channels + subscription status from `/api/v1/comm/channels`.
- Subscribe / Unsubscribe buttons per channel (rank-gated, error feedback).
- System stats panel (total subscriptions, active channels, max subscribers).
- Rank-aware styling: each channel card uses the color palette of its minimum tier.
- Link to `/rank` page for users who need more rank points.

Layout updated: `📡 Channels` nav link added between `🏆 Rank` and `Admin`.

---

## New Files

| File | Purpose |
|------|---------|
| `db/migration_phase18.sql` | comm_subscriptions + streak_events tables |
| `apps/web/src/app/comm/page.jsx` | CommChannels subscription UI |
| `tests/v135RankHardening.test.js` | ~35 tests |
| `docs/CHANGELOG_V135.md` | This file |
| `MIGRATION_NOTES_V135.md` | Upgrade guide |

## Modified Files

| File | Change |
|------|--------|
| `ecos-api-server.js` | RH-01 hard enforcement; RH-03/04 rank wiring |
| `lib/userAccount.js` | RH-03 referral rank event + _rankSystem slot |
| `lib/engagementEngine.js` | RH-04 streak milestone events + _rankSystem/_db slots |
| `apps/web/src/app/layout.jsx` | RH-05 /comm nav link |
| `package.json` | 134.0.0 → 135.0.0 |

---

## Invariants Preserved

1. ✅ `lib/fiatLedger.js` — NOT modified (sacred, MD5 unchanged)
2. ✅ `lib/auditLog.js`  — NOT modified (sacred, MD5 unchanged)
3. ✅ BigInt-only accounting — rank enforcement uses existing ledger.transfer (BigInt)
4. ✅ No new npm dependencies
5. ✅ All V134 endpoints preserved
6. ✅ All new rank events are non-fatal (never block financial transactions)

---

## Tests

| File | Tests |
|------|-------|
| `tests/v135RankHardening.test.js` | ~35 |

**Expected total: ~1348 passing** (V134: ~1313 + V135: ~35)
