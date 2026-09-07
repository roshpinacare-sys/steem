# CHANGELOG V154 — Admin Intelligence + Persistent Withdrawals + E2E Hardening

**Release:** V154.0.0
**Date:** 2026-05-30
**Phase:** P44 — Production Intelligence
**Base:** V153 — Profile Completeness (≥1327 tests)
**Tests:** ≥1327 + ~72 new V154 = **≥1399 passing**

---

## Why This Phase

V153 closed the last UX surface gap and declared the product "deploy-ready."
V154 makes the first deployment *trustworthy* and *observable*:

1. **The admin had no real-time intelligence.** The V148 dashboard showed
   system readiness and account balances — but no live validator count, no
   daily payout trend, no audit event feed. V154 adds three new admin sections:
   Platform Stats (live), Audit Event Feed (last 10), and Daily Payout Chart.

2. **Withdrawals were lost on tab close.** V152 stored withdrawals in
   sessionStorage — ephemeral, gone on tab close. V154 promotes to localStorage
   with API sync: `saveDurableWithdrawal`, `loadDurableWithdrawalHistory`,
   `updateDurableWithdrawalStatus`. The wallet page gains a persistent
   WithdrawalHistoryPanel with timeline view and CSV export.

3. **No security headers.** V154 adds a global Express middleware injecting
   five security headers: X-Content-Type-Options, X-Frame-Options,
   X-XSS-Protection, Referrer-Policy, Permissions-Policy.

4. **Missing platform summary for the dashboard.** GET /api/v1/dashboard/summary
   gives the /dashboard page a live strip: validators, pending tasks,
   auto-flow rate, 7-day payout.

5. **No operator reports surface.** V154 adds /reports — a new page that
   surfaces the existing operator report PDF generation in a clean UI.

6. **Withdrawal history had no DB persistence.** V154 adds migration_phase29.sql
   (withdrawal_history table) and lib/withdrawalHistoryService.js.

---

## Tasks

| ID | Category | Description |
|----|----------|-------------|
| T01 | VERSION  | package.json → 154.0.0 |
| T02 | BACKEND  | GET /api/v1/admin/stats — live platform stats |
| T03 | BACKEND  | GET /api/v1/admin/events — last 10 audit events |
| T04 | BACKEND  | GET /api/v1/admin/validators/stats |
| T05 | BACKEND  | GET /api/v1/withdrawals/history + POST + PATCH endpoints |
| T06 | DB       | migration_phase29.sql — withdrawal_history table |
| T07 | SECURITY | Global security headers middleware (5 headers) |
| T08 | BACKEND  | GET /api/v1/dashboard/summary |
| T09 | BACKEND  | GET /api/v1/leaderboard/extended |
| T10 | BACKEND  | Cache-Control headers on read-only endpoints |
| T11 | BACKEND  | GET /api/v1/system/readiness/v154 with pool stats |
| T12 | BACKEND  | GET /api/v1/admin/payouts/daily — 24h hourly breakdown |
| T13 | FRONTEND | /admin — Platform Stats section (live, 30s poll) |
| T14 | FRONTEND | /admin — Audit Event Feed section (15s poll) |
| T15 | FRONTEND | /admin — Daily Payout bar chart |
| T16 | FRONTEND | /admin — formatStatValue, classifyHealth, verdictColor, buildPayoutChart helpers |
| T17 | FRONTEND | /wallet — loadDurableWithdrawalHistory (localStorage) |
| T18 | FRONTEND | /wallet — WithdrawalHistoryPanel with timeline view |
| T19 | FRONTEND | /wallet — CSV export for withdrawal history |
| T20 | FRONTEND | /dashboard — PlatformSummaryStrip component |
| T21 | FRONTEND | /leaderboard — EarningsTab component |
| T22 | FRONTEND | (leaderboard improved) |
| T23 | FRONTEND | (me page preserved) |
| T24 | FRONTEND | (validator-dashboard preserved) |
| T25 | FRONTEND | layout.jsx — V154 title + /reports nav link |
| T26 | FRONTEND | (onboarding preserved) |
| T27 | FRONTEND | NEW /reports page — PDF generation + report list + snapshot |
| T28 | FRONTEND | (NotificationNavItem preserved) |
| T29 | TEST     | v154AdminDashboard.test.js (~14 tests) |
| T30 | TEST     | v154WithdrawalHistory.test.js (~12 tests) |
| T31 | TEST     | v154DashboardSummary.test.js (~10 tests) |
| T32 | TEST     | v154SecurityHeaders.test.js (~8 tests) |
| T33 | TEST     | v154LocalStorageWithdrawals.test.js (~10 tests) |
| T34 | TEST     | v154AdminEndpoints.test.js (~10 tests) |
| T35 | TEST     | v154E2ERegression.test.js (~12 tests) |
| T36 | TEST     | v154LeaderboardExtended.test.js (~8 tests) |
| T37 | DOCS     | CHANGELOG_V154.md (this file) |
| T38 | DOCS     | MIGRATION_NOTES_V154.md |
| T39 | DOCS     | NEXT_SESSION_PROMPT_V154.md |
| T40 | DOCS     | CLAUDE_CONTEXT.md update |
| T41 | DOCS     | docs/openapi.json additions |
| T42 | DOCS     | README.md update |
| T43 | SCRIPTS  | scripts/smoke-live.js — V154 admin endpoint checks |
| T44 | SCRIPTS  | scripts/pre-deploy-check.js — V154 security checks |

---

## New Files

| File | Purpose |
|------|---------|
| `lib/adminStatsService.js`         | getPlatformStats, getRecentEvents, getDailyPayoutBreakdown, getDashboardSummary |
| `lib/withdrawalHistoryService.js`  | saveWithdrawal, updateWithdrawalStatus, getWithdrawalHistory (DB + file fallback) |
| `db/migration_phase29.sql`         | withdrawal_history table with index + trigger |
| `apps/web/src/app/reports/page.jsx` | NEW /reports page |
| `tests/v154AdminDashboard.test.js`  | 14 tests |
| `tests/v154WithdrawalHistory.test.js` | 12 tests |
| `tests/v154DashboardSummary.test.js`  | 10 tests |
| `tests/v154SecurityHeaders.test.js`   | 8 tests |
| `tests/v154LocalStorageWithdrawals.test.js` | 10 tests |
| `tests/v154AdminEndpoints.test.js`    | 10 tests |
| `tests/v154E2ERegression.test.js`     | 12 tests |
| `tests/v154LeaderboardExtended.test.js` | 8 tests |

---

## Modified Files

| File | Changes |
|------|---------|
| `package.json`                           | version 153.0.0 → 154.0.0 |
| `ecos-api-server.js`                     | +10 new endpoints + security middleware |
| `apps/web/src/app/admin/page.jsx`        | +PlatformStatsSection, AuditEventFeedSection, DailyPayoutChartSection |
| `apps/web/src/app/wallet/page.jsx`       | +WithdrawalHistoryPanel, localStorage helpers, CSV export |
| `apps/web/src/app/dashboard/page.jsx`    | +PlatformSummaryStrip |
| `apps/web/src/app/leaderboard/page.jsx`  | +EarningsTab |
| `apps/web/src/app/layout.jsx`            | +/reports nav, V154 title |

---

## Sacred Files (UNCHANGED)

```
lib/fiatLedger.js  MD5: 563e9b1f9e67091a5b6527c0a92568e5  ← UNCHANGED
lib/auditLog.js    MD5: e5a5c2c27801d2d03991bc8e5a1df8cb  ← UNCHANGED
```
