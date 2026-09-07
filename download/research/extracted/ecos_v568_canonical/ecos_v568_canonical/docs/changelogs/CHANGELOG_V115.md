# ECOS V115 Changelog

**Released:** 2026-05-29
**Version:** 115.0.0
**Previous:** 114.0.0

---

## Overview

V115 implements the full P11 research integration batch: ThreeWayRouter is now wired
into the API server, the Graduation ladder is exposed as a live API, ISO 20022 fields
are available for every value-moving audit event, displaced-worker onboarding is live
with paid orientation tasks (max 60 s each), golden tasks protect validator quality,
Sybil resistance guards onboarding, a NIST AI RMF self-assessment endpoint is
available, and the stablecoin rail adapter (BVNK / Bridge / Circle) is stubbed for
Phase 2 activation.

---

## New Features

### T01 — ThreeWayRouter wired into API server (P11-01)
- `POST /api/v1/route-task` — evaluate a task through the three-way confidence router
- `GET  /api/v1/route-task/config` — router thresholds, high-stakes domain list
- Replaces documentation-only status from V114; now returns verdicts via HTTP
- Verdicts: `AUTO_FLOW` | `BEGINNER_QUEUE` | `SENIOR_QUEUE`

### T02 — Graduation Ladder API (P11-02)
- `GET  /api/v1/users/:id/graduation` — progression report + evaluate advance
- `GET  /api/v1/graduation/stages` — full USE→VERIFY→OWN→RECRUIT→MENTOR definition
- Bonus credits on stage advance: VERIFY +10, OWN +25, RECRUIT +25, MENTOR +50
- Query params: `validationsCompleted`, `patchesAuthored`, `referralsConverted`, `menteeActivated`

### T03 — ISO 20022 Fields in Audit Events (P11-03)
- `POST /api/v1/audit/iso20022/build` — build ISO 20022-compatible payment metadata
- `lib/iso20022Fields.js` was V114; V115 exposes it via API for client pre-structuring
- All value-moving audit events can now include `iso20022` compliance block
- Travel Rule threshold: $3,000 USD (US FinCEN / FATF R.16)

### T04 — Displaced Worker Onboarding (P11-06)
- `GET  /api/v1/onboarding/orientation-tasks` — list all paid orientation tasks
- `GET  /api/v1/onboarding/next-task/:userId` — get next task for user
- `POST /api/v1/onboarding/complete-task` — submit answer, credit $0.25 immediately
- `GET  /api/v1/onboarding/progress/:userId` — onboarding completion status
- 5 built-in orientation tasks (legal + insurance + compliance domains)
- All tasks ≤ 60 seconds; first task ≤ 30 seconds
- Pay: 2,500 microcents ($0.25) per task, credited immediately on completion

### T05 — Golden Tasks for Validator QC (P11-08)
- `GET  /api/v1/validator/golden-tasks/next` — select next golden task (no answer exposed)
- `GET  /api/v1/validator/golden-tasks/library` — public task library
- `POST /api/v1/validator/golden-tasks/submit` — grade validator answer against key
- `GET  /api/v1/validator/golden-tasks/score/:validatorId` — accuracy score
- `GET  /api/v1/validator/golden-tasks/flagged` — validators below 80% accuracy
- 8 built-in golden tasks across legal, insurance, finance, compliance, general domains
- ~8% injection rate; validators below 80% accuracy are flagged after 3+ submissions

### T06 — Sybil Resistance in Validator Onboarding (P11-09)
- `POST /api/v1/validator/onboard` — register validator with Sybil screening
- `GET  /api/v1/validator/sybil/flagged` — list BLOCK/REVIEW decisions
- Detection signals: IP velocity, email alias/reuse, device fingerprint, perfect skill test, referral depth
- Verdict: `ALLOW` (0-39) | `REVIEW` (40-69) | `BLOCK` (≥70)
- 201 on ALLOW, 202 on REVIEW, 403 on BLOCK

### T07 — NIST AI RMF Self-Assessment Report (P11-04)
- `GET /api/v1/audit/nist-ai-rmf-report` — structured NIST AI RMF 1.0 self-assessment
- Covers all 4 functions: GOVERN, MAP, MEASURE, MANAGE
- 16 categories across the 4 functions with compliance status and detail
- Includes `overallReadiness` percentage and remediation `recommendations`

### T08 — Stablecoin Rails Stub (P11-07)
- `lib/rails/stablecoinRail.js` — adapter interface for BVNK, Bridge (Stripe), Circle CPN
- `GET  /api/v1/rails/stablecoin/config` — provider config and Phase 2 activation guide
- `POST /api/v1/rails/stablecoin/deposit` — initiate deposit (stub Phase 0)
- `POST /api/v1/rails/stablecoin/withdraw` — initiate withdrawal (stub Phase 0)
- `GET  /api/v1/rails/stablecoin/status/:ref` — transaction status by reference
- `POST /api/v1/rails/stablecoin/webhook` — provider webhook handler
- ISO 20022 metadata on every transaction; GENIUS Act compliance flags
- Activate Phase 2: set `ECOS_STABLECOIN_PROVIDER` + `ECOS_STABLECOIN_API_KEY`

### T09 — New Test Suites
- `tests/v115ThreeWayRouter.test.js`  — 12 tests (P11-01)
- `tests/v115GraduationEngine.test.js` — 9 tests (P11-02)
- `tests/v115Iso20022Fields.test.js`  — 11 tests (P11-03)
- `tests/v115OnboardingEngine.test.js` — 9 tests (P11-06)
- `tests/v115GoldenTaskEngine.test.js` — 12 tests (P11-08)
- `tests/v115SybilResistance.test.js` — 9 tests (P11-09)
- `tests/v115StablecoinRail.test.js`  — 12 tests (P11-07)
- `tests/v115NistReport.test.js`      — 5 tests (P11-04)
- `tests/v115version.test.js`         — 2 tests (version bump)

### T10 — Version, Docs, DB Migration
- `package.json` → `115.0.0`
- `docs/CHANGELOG_V115.md` (this file)
- `MIGRATION_NOTES_V115.md`
- `V115_NEXT_SESSION_PROMPT.md`
- `db/migration_phase11.sql` — sybil_decisions, golden_task_submissions, golden_task_scores, orientation_progress, stablecoin_transactions

---

## New Files

| File | Purpose |
|------|---------|
| `lib/onboardingEngine.js`         | Displaced worker orientation (P11-06) |
| `lib/goldenTaskEngine.js`         | Golden task QC engine (P11-08) |
| `lib/sybilResistance.js`          | Sybil detection for validator onboarding (P11-09) |
| `lib/rails/stablecoinRail.js`     | Stablecoin rail adapter stub (P11-07) |
| `db/migration_phase11.sql`        | V115 DB schema additions |
| `tests/v115ThreeWayRouter.test.js` | 12 tests |
| `tests/v115GraduationEngine.test.js` | 9 tests |
| `tests/v115Iso20022Fields.test.js` | 11 tests |
| `tests/v115OnboardingEngine.test.js` | 9 tests |
| `tests/v115GoldenTaskEngine.test.js` | 12 tests |
| `tests/v115SybilResistance.test.js` | 9 tests |
| `tests/v115StablecoinRail.test.js` | 12 tests |
| `tests/v115NistReport.test.js`    | 5 tests |
| `tests/v115version.test.js`       | 2 tests |

---

## New Endpoints (V115)

| Method | Path | Feature |
|--------|------|---------|
| POST | `/api/v1/route-task` | ThreeWayRouter evaluate |
| GET  | `/api/v1/route-task/config` | Router config |
| GET  | `/api/v1/users/:id/graduation` | Graduation ladder status |
| GET  | `/api/v1/graduation/stages` | Ladder definition |
| POST | `/api/v1/audit/iso20022/build` | ISO 20022 metadata builder |
| GET  | `/api/v1/audit/nist-ai-rmf-report` | NIST AI RMF self-assessment |
| GET  | `/api/v1/onboarding/orientation-tasks` | List orientation tasks |
| GET  | `/api/v1/onboarding/next-task/:userId` | Next task for user |
| POST | `/api/v1/onboarding/complete-task` | Submit + credit |
| GET  | `/api/v1/onboarding/progress/:userId` | Onboarding progress |
| GET  | `/api/v1/validator/golden-tasks/next` | Select golden task |
| GET  | `/api/v1/validator/golden-tasks/library` | Task library |
| POST | `/api/v1/validator/golden-tasks/submit` | Grade answer |
| GET  | `/api/v1/validator/golden-tasks/score/:id` | Accuracy score |
| GET  | `/api/v1/validator/golden-tasks/flagged` | Flagged validators |
| POST | `/api/v1/validator/onboard` | Register + Sybil check |
| GET  | `/api/v1/validator/sybil/flagged` | Sybil decisions |
| GET  | `/api/v1/rails/stablecoin/config` | Rail config |
| POST | `/api/v1/rails/stablecoin/deposit` | Deposit stub |
| POST | `/api/v1/rails/stablecoin/withdraw` | Withdrawal stub |
| GET  | `/api/v1/rails/stablecoin/status/:ref` | Tx status |
| POST | `/api/v1/rails/stablecoin/webhook` | Provider webhook |

---

## Sacred Files — Unchanged

| File | MD5 |
|------|-----|
| `lib/fiatLedger.js` | `563e9b1f9e67091a5b6527c0a92568e5` |
| `lib/auditLog.js`   | `e5a5c2c27801d2d03991bc8e5a1df8cb` |

---

## Environment Variables (New in V115)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `ECOS_STABLECOIN_PROVIDER` | No | `stub` | Active stablecoin provider (`bvnk`, `bridge`, `circle`, `stub`) |
| `ECOS_STABLECOIN_API_KEY` | Phase 2 | — | Provider API key — activates live mode |
| `ECOS_STABLECOIN_WEBHOOK_SECRET` | Phase 2 | — | Webhook HMAC secret for provider callbacks |

---

*ECOS CHANGELOG_V115.md · V114 → V115 · 2026-05-29*
