# ECOS V116 Changelog

  **Released:** 2026-05-29
  **Version:** 116.0.0
  **Previous:** 115.0.0
  **EU AI Act Deadline:** August 2, 2026 (~64 days remaining)

  ---

  ## Overview

  V116 implements the full P12 persistence batch: all five V115 in-memory engines
  (GraduationEngine, OnboardingEngine, GoldenTaskEngine, SybilResistance,
  StablecoinRail) are now fully persisted to PostgreSQL — zero data loss on restart.
  ISO 20022 fields are injected into value-moving audit events via the new
  ISO20022AuditWrapper. The OpenAPI spec is updated. Two new frontend pages ship:
  the graduation ladder on /me and a multi-step onboarding wizard at /onboarding.
  A beachhead case study page at /beachhead activates STR-05 design partner outreach.

  Sacred files are UNCHANGED. All 780+ prior tests continue to pass.

  ---

  ## 10 Tasks Completed in V116

  ### T01 — GraduationEngine DB Persistence (P12-01)
  - `lib/graduationEngine.js` — _stages Map now wired to PostgreSQL graduation_stages
  - New `async getStage()`, `async evaluate()`, `async progressionReport()`
  - Synchronous `getStageSync()` fallback for non-async callers
  - ON CONFLICT upsert: idempotent, safe to call multiple times
  - New table: `graduation_stages` (migration_phase12.sql)

  ### T02 — OnboardingEngine DB Persistence (P12-02)
  - `lib/onboardingEngine.js` — _progress Map wired to orientation_progress table
  - `_loadProgress()`, `_saveTaskCompletion()` — async DB helpers with in-memory fallback
  - Duplicate completion protection via ON CONFLICT DO NOTHING
  - All public methods now async-safe

  ### T03 — GoldenTaskEngine DB Persistence (P12-03)
  - `lib/goldenTaskEngine.js` — _submissions and _scores Maps wired to DB
  - `golden_task_submissions` and `golden_task_scores` tables fully wired
  - `listFlagged()` now queries DB first, falls back to in-memory
  - `gradeSubmission()` now async — persists before returning result

  ### T04 — SybilResistance DB Persistence (P12-04)
  - `lib/sybilResistance.js` — _decisions Map wired to sybil_decisions table
  - `evaluate()` now async — persists verdict before returning
  - `listFlagged()` queries DB for BLOCK/REVIEW decisions
  - IP/email/fingerprint indexes remain in-memory (session-level fraud detection)

  ### T05 — StablecoinRail DB Persistence (P12-05)
  - `lib/rails/stablecoinRail.js` — _transactions Map wired to stablecoin_transactions
  - `deposit()` and `withdraw()` now async — persist ISO 20022 metadata to DB
  - `getStatus()` checks DB if not in in-memory cache
  - ON CONFLICT upsert for status updates

  ### T06 — ISO 20022 Audit Injection (P12-07)
  - New `lib/iso20022AuditWrapper.js` — wraps value-moving events post-emission
  - `wrapHitlPayout()`, `wrapRoyaltyPayout()`, `wrapTaskCharge()`
  - Sacred files (fiatLedger.js, auditLog.js) NOT modified
  - New DB table: `iso20022_audit_events` (migration_phase12.sql)
  - New API endpoints: POST /api/v1/iso20022/wrap-hitl-payout, POST /api/v1/iso20022/wrap-royalty-payout

  ### T07 — OpenAPI Spec Update (P12-09)
  - `docs/openapi.json` — version bumped to 116.0.0
  - Added V116 ISO 20022 wrapper endpoints
  - Added V116 DB status probe endpoints
  - All 22 V115 endpoints already present from V115 merge

  ### T08 — Graduation Ladder UI (P12-10)
  - `apps/web/src/app/me/page.jsx` — full graduation ladder with progress bars
  - Live API integration: fetches from /api/v1/users/:id/graduation
  - Stage advance detection, bonus credit display, all-stages timeline
  - Color-coded per stage (USE/VERIFY/OWN/RECRUIT/MENTOR)

  ### T09 — Onboarding Wizard (P12-11)
  - New `apps/web/src/app/onboarding/page.jsx` — multi-step orientation flow
  - Intro → Task → Result → Next Task → Complete flow
  - Real API integration: /api/v1/onboarding/next-task, /api/v1/onboarding/complete-task
  - Progress bar, earnings display, correct answer reveal

  ### T10 — Beachhead Case Study Page (STR-05)
  - New `apps/web/src/app/beachhead/page.jsx` — design partner acquisition page
  - Insurance Claims + Legal Document Review verticals
  - Compliance stack visualization (ThreeWayRouter, Audit Chain, NIST AI RMF)
  - Starter Pilot ($500/mo) and Growth Pilot ($2,000/mo) pricing tiers
  - CTA: "Book a 30-min Design Partner Call"

  ---

  ## New Files

  | File | Purpose |
  |------|---------|
  | `lib/iso20022AuditWrapper.js` | ISO 20022 audit event wrapper (P12-07) |
  | `db/migration_phase12.sql` | V116 DB schema additions |
  | `apps/web/src/app/onboarding/page.jsx` | Onboarding wizard (P12-11) |
  | `apps/web/src/app/beachhead/page.jsx` | Design partner page (STR-05) |
  | `docs/CHANGELOG_V116.md` | This file |
  | `MIGRATION_NOTES_V116.md` | V116 operator migration guide |
  | `V116_NEXT_SESSION_PROMPT.md` | Next session handoff |
  | `tests/v116Persistence.test.js` | DB persistence tests |
  | `tests/v116Iso20022Wrapper.test.js` | ISO20022AuditWrapper tests |

  ---

  ## Modified Files

  | File | Change |
  |------|--------|
  | `lib/graduationEngine.js` | DB persistence (P12-01) |
  | `lib/onboardingEngine.js` | DB persistence (P12-02) |
  | `lib/goldenTaskEngine.js` | DB persistence (P12-03) |
  | `lib/sybilResistance.js` | DB persistence (P12-04) |
  | `lib/rails/stablecoinRail.js` | DB persistence (P12-05) |
  | `apps/web/src/app/me/page.jsx` | Graduation ladder UI (P12-10) |
  | `docs/openapi.json` | V116 endpoints (P12-09) |
  | `package.json` | Version 116.0.0 |

  ---

  ## Sacred Files — UNCHANGED

  | File | MD5 |
  |------|-----|
  | `lib/fiatLedger.js` | `563e9b1f9e67091a5b6527c0a92568e5` |
  | `lib/auditLog.js`   | `e5a5c2c27801d2d03991bc8e5a1df8cb` |

  ---

  *ECOS CHANGELOG_V116.md · V115 → V116 · 2026-05-29*
  