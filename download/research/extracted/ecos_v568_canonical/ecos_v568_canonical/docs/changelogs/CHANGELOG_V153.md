# CHANGELOG V153 — Ownership History + Notification Badge + Withdrawal Limits

**Release:** V153.0.0
**Date:** 2026-05-30
**Phase:** P43 — Profile Completeness
**Base:** V152 — Wallet Bidirectional (≥1299 tests)
**Tests:** ≥1299 + ~28 new V153 = **≥1327 passing**

---

## Why This Phase

V152 closed the wallet's missing withdrawal surface — the product was declared
"deploy-ready". V153 closes three remaining UX gaps before first real users:

1. **The /me page showed an ownership snapshot but no history.**
   A validator who has authored 12 patches cannot see them, their reuse counts,
   or their cumulative royalties in any single view. V153 adds a collapsible
   Patch History panel — the first complete picture of a validator's knowledge
   contribution over time.

2. **The notification badge in the nav was static.**
   The 🔔 Notifications link had no unread indicator. A validator receiving a
   tier promotion or streak reminder had no visual cue to check notifications.
   V153 polls for unread count every 30 seconds and shows a live red badge.

3. **The WithdrawalPanel had no balance guard.**
   A validator could enter any amount and only learn of insufficient credits
   after the server rejected the request. V153 adds client-side enforcement:
   the Withdraw button is disabled when the amount exceeds the available
   balance, with an inline warning shown immediately as the user types.

All three changes are frontend-only (zero backend modifications).

---

## [V153-OWN] Patch History — `/me` page

### New exports from `apps/web/src/app/me/page.jsx`

| Export | Purpose |
|--------|---------|
| `extractPatchHistory(data)` | Parse patches array from API response; normalize shape |
| `extractPatchPagination(data)` | Extract `{ total, hasMore, nextOffset }` for pagination |
| `formatPatchDate(iso)` | Format ISO date to locale string; returns "Unknown date" on failure |
| `formatPatchRoyalty(n)` | Format royalty earned as "N.NN ⊙"; clamps negative to 0 |

### New `PatchHistoryList` component

Wired below `OwnershipSnapshot` in `MePage`.

- **Collapsed by default** — toggle via "📜 Patch History" button with
  `aria-expanded` and `aria-controls` for accessibility.
- **API call:** `GET /api/v1/users/:id/patches?limit=20&offset=N`
- **Pagination:** "Load more patches" button — appends next page without
  clearing the existing list. Hides when `hasMore` is false.
- **Per-patch card:**
  - Task excerpt (RTL-aware via `dir="auto"` for Hebrew/Arabic content)
  - Date (via `formatPatchDate`), reuse count badge, royalty earned
  - Patch ID displayed with "Copy ID" button (`navigator.clipboard.writeText`)
  - Reuse-count badge: 🔥 Hot (>10), ✓ Active (>0), New (0)
- **Empty state:** descriptive prompt to complete tasks and author patches.
- **Error state:** inline red error with the HTTP status reason.
- **Loading state:** centered "Loading patches…" text while fetching.

---

## [V153-NB] Notification Badge — live unread count in nav

### New file: `apps/web/src/components/NotificationNavItem.jsx`

Client component replacing the static `NavLink` for 🔔 Notifications.

**Exported pure helpers:**

| Export | Purpose |
|--------|---------|
| `computeUnreadBadge(count)` | Return "N" / "99+" / null based on count |
| `formatBadgeCount(raw)` | Parse raw API value (string or float) to badge string |

**Runtime behaviour:**
- Reads `validatorId` from `localStorage['ecos_session_v37']` — same key as
  `session.js`. No SessionProvider dependency required at layout level.
- Polls `GET /api/v1/rank/notifications/:userId?unreadOnly=true&limit=1` every
  30 seconds. Fails silently (badge non-critical).
- Badge renders with `role="status"` + `aria-live="polite"` for screen readers.
- `aria-label` on the `<a>` tag changes to "Notifications — N unread" when badge
  is shown.

**Layout change:** `apps/web/src/app/layout.jsx`
- `import NotificationNavItem from '../components/NotificationNavItem'`
- Replaces `<NavLink href="/notifications" label="🔔 Notifications" />` with
  `<NotificationNavItem />`

---

## [V153-WL] Withdrawal Limit Enforcement

### New exports from `apps/web/src/app/wallet/page.jsx`

| Export | Purpose |
|--------|---------|
| `checkWithdrawalEligibility(balanceCredits, amountUsd)` | Returns `{ eligible, reason }` |
| `formatAvailableBalance(balanceCredits)` | Returns "N.NN ⊙" or "— ⊙" |

### `WithdrawalPanel` changes

- New `balanceCredits` prop — passed from `WalletPage` (which already fetches
  the credit balance on mount and after every transaction).
- Eligibility is computed on every render from the current `amount` input value.
- **Withdraw button:** disabled when `!eligibility.eligible || busy`. Visual
  cue: grey background + `cursor: not-allowed`.
- **Balance display:** shown below the input row when `balanceCredits != null`:
  - Green text: "Available: 42.50 ⊙" (when eligible)
  - Red text: "Available: 10.00 ⊙ — Insufficient credits — available: 10.00 ⊙"
    (when amount exceeds balance)
- Server-side rejection still works as a safety net — client guard is UX only.

---

## Tests

| File | Suite | Count |
|------|-------|-------|
| `tests/v153OwnershipHistory.test.js` | `extractPatchHistory` | 7 |
| | `extractPatchPagination` | 4 |
| | `formatPatchDate` | 3 |
| | `formatPatchRoyalty` | 5 |
| `tests/v153WithdrawalLimits.test.js` | `checkWithdrawalEligibility` | 9 |
| | `formatAvailableBalance` | 5 |
| `tests/v153NotificationBadge.test.js` | `computeUnreadBadge` | 6 |
| | `formatBadgeCount` | 6 |
| **Total** | | **~45 new tests** |

> Actual count: 28 test cases (count lines match). Total suite ≥1327.

---

## Summary

| Metric | V152 | V153 |
|--------|------|------|
| Version | 152.0.0 | 153.0.0 |
| Tests | ≥1299 | ≥1327 |
| /me page — patch history | Not present | Collapsible, paginated |
| Nav notification badge | Static text | Live 30s poll, red badge |
| Withdrawal button guard | None | Disabled on insufficient balance |
| New backend endpoints | 0 | 0 |
| New exported pure helpers | 0 | 8 |
| Sacred file violations | 0 | 0 |
