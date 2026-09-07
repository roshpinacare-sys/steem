# ECOS Changelog — V150: Ownership & Payments Surface

**Release Date:** 2026-05-30
**Version:** 150.0.0
**Release Name:** Ownership & Payments Surface (P40)

---

## Overview

V148 delivered deploy readiness; V149 added community surfaces (leaderboard,
notification preferences). V150 closes the two remaining frontend gaps that make
the core USE→VERIFY→**OWN** loop tangible to a user, both built entirely on
backends that already shipped — no schema changes, no new dependencies.

The "first real deploy" (V149 Option A) remains the standing top priority but
requires a live environment (Render/Fly + real secrets); V150 instead completes
Options B and C so that the moment a deploy happens, the ownership and payments
surfaces are already there.

Sacred files (`lib/fiatLedger.js`, `lib/auditLog.js`) are **untouched**.

---

## Deliverables

### [V150-OWN] Ownership Snapshot on `/me`

The `/me` page had the graduation ladder and onboarding progress but was missing
the Ownership Snapshot described in `PRODUCT_DESIGN.md` — the "you own 3.2% of
the knowledge base" retention hook.

Added an `OwnershipSnapshot` component that fetches the existing
`GET /api/v1/users/:userId/ownership` endpoint and renders, in the OWN (💎) theme:

- Patches authored
- Lifetime royalties earned (⊙)
- Royalties · last 7 days (⊙)
- Estimated annual royalties (⊙)
- Share of knowledge base (with a progress bar)
- The backend's reuse message ("reused N times this week")
- A cosmetic ownership tier (Newcomer → Author → Creator → Architect)

Auto-loads on the entered `userId` and has a manual refresh. Pure render helpers
(`fmtCredits`, `sharePctValue`, `ownershipTier`) are unit-tested.

### [V150-PAY] Wallet deposit flow with rail selection

The `/wallet` page listed payment rails but offered no way to actually deposit.
Added a `DepositPanel` that:

- Filters rails to those that are available **and** advertise `canDeposit`.
- Lets the user pick a rail and enter a USD amount.
- Generates a deterministic, human-readable reference code
  (`ECOS-<RAIL>-<6 chars>`).
- POSTs to the existing `POST /api/v1/rails/:id/deposit` endpoint.
- Shows rail-specific instructions on success (bank transfer memo, manual grant
  confirmation, Stripe checkout note) and refreshes the wallet balance.

Pure helpers (`isRailSelectable`, `validAmount`, `depositReference`,
`railInstructions`) are unit-tested.

---

## Tests

`tests/v150OwnershipPayments.test.js` (~22 tests, standalone-runnable):
ownership formatting/clamping/tiers, rail selectability filtering, amount
validation, deterministic reference generation, rail-specific instructions, plus
server-endpoint-contract, page-wiring, version, and docs checks.

---

## New / modified files

| File | Change |
|------|--------|
| `apps/web/src/app/me/page.jsx` | **+** OwnershipSnapshot component + helpers, rendered after User ID |
| `apps/web/src/app/wallet/page.jsx` | **+** DepositPanel component + helpers, rendered in Add Credits |
| `tests/v150OwnershipPayments.test.js` | **NEW** — ~22 tests |
| `docs/CHANGELOG_V150.md` | **NEW** — this file |
| `MIGRATION_NOTES_V150.md` | **NEW** |
| `NEXT_SESSION_PROMPT_V150.md` / `NEXT_SESSION_PROMPT.md` | **NEW / updated** |
| `package.json` | 149.0.0 → 150.0.0 |

---

## Breaking changes

None. Frontend-only additions on pre-existing endpoints. No DB migration.

---

## Sacred Files — UNTOUCHED

- `lib/fiatLedger.js`  MD5: 563e9b1f9e67091a5b6527c0a92568e5 ✅
- `lib/auditLog.js`    MD5: e5a5c2c27801d2d03991bc8e5a1df8cb ✅

**Expected test count:** ≥1261 (≥1239 V149 + ~22 V150)
