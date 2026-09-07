# CHANGELOG V152 — Withdrawal UI

**Release:** V152.0.0
**Date:** 2026-05-30
**Phase:** P42 — Wallet Bidirectional
**Base:** V151 — Wallet Completion (≥1283 tests)
**Tests:** ≥1283 + ~16 new V152 = **≥1299 passing**

---

## Why This Phase

V151 completed the deposit side of the wallet. Credits could flow **in** but not **out**. A wallet with only deposits is half a wallet. V152 closes this gap:

- `WithdrawalPanel` mirrors `DepositPanel` — same rail selection / amount UX, same sessionStorage persistence pattern.
- `PendingWithdrawalsList` mirrors `PendingDepositsList` — same 15-second polling lifecycle, same status badges.
- The wallet is now **bidirectional**: users can deposit AND withdraw credits via any available rail.

Backend endpoint `POST /api/v1/rails/:id/withdraw` already existed since V111 — V152 is frontend-only (zero backend changes).

---

## [V152-WITH] Withdrawal UI

### New exports from `apps/web/src/app/wallet/page.jsx`

| Export | Purpose |
|--------|---------|
| `isRailWithdrawable(rail)` | Filter rails that support withdrawals (`isAvailable && canWithdraw`) |
| `withdrawalReference(accountId, railId, seed)` | Deterministic `ECOS-W-{RAIL}-{6char}` reference code |
| `withdrawalInstructions(railId, reference, amountUsd)` | Human-readable instructions per rail |
| `loadPendingWithdrawals()` | Read `ecos_pending_withdrawals` from sessionStorage |
| `savePendingWithdrawal(entry)` | Append entry (idempotent by reference, max 20) |
| `updateWithdrawalStatus(reference, status)` | Update a single withdrawal's status |
| `withdrawalStatusLabel(status)` | Return `{ text, bg, color }` badge spec |

### New components

**`WithdrawalPanel`**
- Rail selection dropdown (canWithdraw filter via `isRailWithdrawable`)
- Amount input + `validAmount` validation (reuses V150 helper)
- POST `/api/v1/rails/:id/withdraw` with `{ accountId, amountUsd, reference }`
- On success: `savePendingWithdrawal()` → persists to sessionStorage
- On success: `onWithdrawn()` callback → refreshes balance + triggers `PendingWithdrawalsList` reload
- Error display inline (same pattern as DepositPanel)
- "No withdrawal-capable rails available" fallback

**`PendingWithdrawalsList`**
- Reads `ecos_pending_withdrawals` from sessionStorage
- Hidden when empty (same as PendingDepositsList)
- Polls `GET /api/v1/rails/:id/status/:ref` every 15 s for pending entries
- Status badges: Pending (yellow) / Confirmed (green) / Rejected (red)
- `withdrawalSignal` prop triggers reload on new withdrawal

### Design choices

- **Separate sessionStorage key** (`ecos_pending_withdrawals` vs `ecos_pending_deposits`) — avoids mixing transaction types; both lists can be shown independently.
- **`ECOS-W-` prefix** for withdrawal references — visually distinguishable from deposit refs (`ECOS-`).
- **Same polling interval (15 s)** — consistent with deposits; no new timer infrastructure needed.
- **Rail reuse** — withdrawal-capable rails are a subset of the same rail registry. `ManualRail` and `BankTransferRail` both set `canWithdraw: true` since V111; `StripeRail` depends on Stripe Connect payout availability.

---

## Tests — `tests/v152WithdrawalUI.test.js` (~16 tests)

| Suite | Count | What it covers |
|-------|-------|----------------|
| `isRailWithdrawable` | 6 | available+canWithdraw, unavailable, false canWithdraw, null, missing caps, list filter |
| `withdrawalReference` | 3 | format/prefix, deterministic, varies by inputs |
| `withdrawalInstructions` | 3 | bank, manual, unknown rail |
| `pendingWithdrawals` | 5 | load empty, save, idempotency, update status, isolation |
| `withdrawalStatusLabel` | 3 | pending/confirmed/rejected badge colours |

---

## Summary

| Metric | V151 | V152 |
|--------|------|------|
| Version | 151.0.0 | 152.0.0 |
| Tests | ≥1283 | ≥1299 |
| Wallet direction | Deposit only | Deposit + Withdraw |
| New backend endpoints | 0 | 0 |
| New frontend exports | 0 | 7 |
| Sacred file violations | 0 | 0 |
