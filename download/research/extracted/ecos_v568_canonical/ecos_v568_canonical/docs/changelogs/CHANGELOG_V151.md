# CHANGELOG V151 — Real Earnings Breakdown + Pending Deposits

**Release:** V151.0.0
**Date:** 2026-05-30
**Phase:** P41 — Wallet Completion
**Base:** V150 — Ownership & Payments Surface (≥1261 tests)
**Tests:** ≥1261 + ~22 new V151 = **≥1283 passing**

---

## Why This Phase

V150 closed the ownership and deposit *initiation* surfaces. Two gaps remained:

1. **Earnings Breakdown was entirely placeholder** — three `0.00` cards hardcoded
   in the wallet page. After a validator completes tasks and receives royalties,
   nothing reflected their real balance breakdown. The data existed in the API
   (three separate endpoints, all wired since V107–V127); it was never fetched.

2. **Deposits disappeared after initiation** — V150 showed a reference code but
   offered no way to track the deposit's lifecycle. A user who initiated a bank
   transfer had no feedback until their credit balance changed.

V151 closes both gaps with frontend-only changes (no backend modifications).

---

## [V151-EARN] Real Earnings Breakdown

### New `EarningsBreakdown` component

Replaces the three static `0.00` cards in the Wallet page's "Earnings Breakdown"
section with a component that fetches real data.

**Three parallel sources (Promise.allSettled):**

| Card | Endpoint | Parser |
|------|----------|--------|
| Validation Earnings | `GET /api/v1/validator/:id/earnings` | `extractValidationEarnings(data)` |
| Royalty Earnings    | `GET /api/v1/users/:id/ownership`   | `extractRoyaltyEarnings(data)`    |
| Referral Bonuses    | `GET /api/v1/account?id=`           | `extractReferralBonus(data)`      |

**Design choices:**
- `Promise.allSettled` — one failed source never crashes the page or blocks the others.
  Each extractor returns `0` on failure; a banner warns the user if any call fails.
- Pure extractor functions exported and unit-tested independently (no mocking of fetch).
- "Total earned" sum row at the bottom of the grid — the first time a user can see
  their total lifetime earnings in one number.
- Manual ↺ Refresh button — lets the user pull fresh data without a page reload
  (useful right after a task settles or a royalty accrues).
- Loading state per card ("…" placeholder) — perceived performance improvement vs
  the old static zeros that looked like no earnings.

---

## [V151-PEND] Pending Deposits

### New `PendingDepositsList` component

Tracks the lifecycle of deposits initiated via the `DepositPanel`.

**How it works:**
1. `DepositPanel.submit()` calls `savePendingDeposit()` on success — writes to
   `sessionStorage['ecos_pending_deposits']` as a JSON array of max 20 entries.
2. `PendingDepositsList` renders when the list is non-empty (hidden otherwise).
3. On mount and every 15 s, it polls `GET /api/v1/rails/:id/status/:ref` for each
   `pending` entry and calls `updateDepositStatus()` to update sessionStorage.
4. Status badge:
   - **Pending** — yellow — awaiting settlement
   - **Confirmed** — green — credits have been (or will be) granted
   - **Rejected** — red — the deposit was declined

**Implementation notes:**
- `sessionStorage` (not `localStorage`) — intentionally session-scoped. Deposits
  older than the session are not meaningful to track.
- All helpers (`loadPendingDeposits`, `savePendingDeposit`, `updateDepositStatus`,
  `depositStatusLabel`) are pure (exported from the page for testability).
- Polling is managed via `setInterval` / `clearInterval` in a `useEffect` with
  proper cleanup — no memory leaks on unmount.

---

## Pure helpers (unit-tested, no network)

All six new helpers are exported from `apps/web/src/app/wallet/page.jsx`:

| Helper | Purpose |
|--------|---------|
| `extractValidationEarnings(data)` | Parse validator earnings from /earnings response |
| `extractRoyaltyEarnings(data)` | Parse royalties from /ownership response |
| `extractReferralBonus(data)` | Parse referral credits from /account response |
| `loadPendingDeposits()` | Read deposits from sessionStorage |
| `savePendingDeposit(entry)` | Append a deposit entry (idempotent by reference) |
| `updateDepositStatus(ref, status)` | Update a single deposit's status |
| `depositStatusLabel(status)` | Return { text, bg, color } for badge rendering |

---

## Tests — `tests/v151EarningsBreakdown.test.js` (~22 tests)

| Suite | Count | What it covers |
|-------|-------|----------------|
| `extractValidationEarnings` | 6 | null, empty, totalEarned, earnings.total, preference, non-numeric |
| `extractRoyaltyEarnings` | 6 | null, number, string, fallback, negative clamp, bad string |
| `extractReferralBonus` | 5 | null, root, nested, string, negative clamp |
| `pendingDeposits` | 5 | load empty, save, idempotency, update status, isolation |

---

## Summary

| Metric | V150 | V151 |
|--------|------|------|
| Version | 150.0.0 | 151.0.0 |
| Tests | ≥1261 | ≥1283 |
| Wallet placeholders | 3 (all 0.00) | 0 |
| Deposit tracking | None | Session-persistent + polled |
| New backend endpoints | 0 | 0 |
| Sacred file violations | 0 | 0 |
