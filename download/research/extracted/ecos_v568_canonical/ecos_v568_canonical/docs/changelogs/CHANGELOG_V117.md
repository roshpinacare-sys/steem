# ECOS V117 Changelog

**Released:** 2026-05-29
**Version:** 117.0.0
**Previous:** 116.0.0
**EU AI Act Deadline:** August 2, 2026 (~64 days remaining)

---

## Overview

V117 wires the ISO 20022 audit wrapper into live API routes, ships a dedicated
Validator Dashboard page, adds an Admin DB Health endpoint, extends the CLI with
a `graduation` command, enriches the SDK types with all P12 entities, and
provides a realistic demo seeder for partner calls. Cursor-based pagination is
added to memory search. Three new DB tables support the wiring log, dashboard
cache, and demo sessions.

Sacred files are UNCHANGED. All 800+ prior tests continue to pass.

---

## 33 Tasks Completed in V117

### CRITICAL

#### T01 — Version bump (117.0.0)
- `package.json` — version bumped to 117.0.0, description updated

#### T02 — P13-01: ISO 20022 Wiring into Live API Routes
- `ecos-api-server.js` — `_v116` IIFE block added
- `POST /api/v1/iso20022/payout-wrap` — call `wrapHitlPayout()` after a payout
- `POST /api/v1/iso20022/royalty-wrap` — call `wrapRoyaltyPayout()` after royalty
- `POST /api/v1/iso20022/task-wrap` — call `wrapTaskCharge()` after task billing
- `GET  /api/v1/iso20022/events` — list recent iso20022_wiring_log entries
- ISO20022AuditWrapper persists to `iso20022_wiring_log` table (phase 13)

#### T03 — P13-02: V116 Persistence Extended Tests
- `tests/v117PersistenceExtended.test.js` — DB round-trip tests for all 5 P12 engines
- GraduationEngine: persist → reload cycle
- OnboardingEngine: complete-task → verify persisted progress
- GoldenTaskEngine: submit → query score from DB mock
- SybilResistance: evaluate BLOCK → listFlagged from DB mock
- StablecoinRail: deposit → getStatus from DB mock

#### T04 — STR-06: Live Demo Seeder
- `scripts/seed-demo.js` — seeds realistic Insurance Claims data
- Creates 5 validators, 20 tasks, 10 HITL approvals, golden tasks, stablecoin deposits
- `npm run demo:seed` added to `package.json`

#### T05 — v117version.test.js
- `tests/v117version.test.js` — asserts package.json version is 117.0.0

### HIGH

#### T06 — P13-05: Validator Dashboard Page
- `apps/web/src/app/validator-dashboard/page.jsx` — new page
- Shows: graduation stage + progress, golden task accuracy, sybil status, today's earnings
- Live API: `/api/v1/validator/dashboard/:validatorId`
- Color-coded stage badges, accuracy progress bar, earnings display

#### T07 — P13-06: Admin DB Persistence Health
- `GET /api/v1/admin/db-health` — new endpoint in `_v116` IIFE
- Returns row counts for all P12 tables: graduation_stages, orientation_progress,
  golden_task_scores, golden_task_submissions, sybil_decisions,
  stablecoin_transactions, iso20022_audit_events, iso20022_wiring_log
- Shows DB availability and per-table health status

#### T08 — P13-07: CLI Graduation Command
- `ecos-cli.js` — new `graduation` command
- `ecos graduation --userId=<id>` — fetch and display graduation stage + progress
- `--url` override for API base URL

#### T09 — P13-08: SDK P12 Types
- `sdk/types.d.ts` — new interfaces: GraduationStage, GraduationReport,
  OnboardingProgress, OnboardingTask, GoldenTaskScore, GoldenTaskResult,
  SybilDecision, StablecoinTransaction, ISO20022Event, ValidatorDashboard

#### T10 — P13-04: Stablecoin Phase 2 Activation
- `ecos-api-server.js` `_v116` — ECOS_STABLECOIN_PROVIDER env var surfaced in config check
- Health endpoint updated to show stablecoin rail phase (Phase 0 / Phase 2)

#### T11 — Stablecoin + ISO20022 counts in health/detailed
- `GET /api/v1/health/detailed` — two new checks added in `_v116`
- `stablecoinRail`: provider, phase, transaction count
- `iso20022Wiring`: events count (from in-memory or DB)

#### T12 — GET /api/v1/validator/dashboard/:validatorId API Endpoint
- Aggregates golden task score, sybil status, graduation stage, earnings
- Single call replaces 4 separate queries in frontend

#### T13 — Memory Search Cursor Pagination
- `GET /api/v1/memory/search` — new `cursor` and `limit` query params
- Cursor is an opaque base64-encoded offset token
- Returns `nextCursor` in response when more results exist

#### T14 — GET /api/v1/iso20022/events Endpoint
- Lists recent ISO 20022 wiring log events with optional type filter
- Supports `?type=HITL_PAYOUT|ROYALTY_PAYOUT|TASK_CHARGE&limit=50`

#### T15 — NIST AI RMF Report Version Updated to V117
- `GET /api/v1/audit/nist-ai-rmf-report` — version string bumped to V117

### MEDIUM

#### T16 — Graduation Filter on Leaderboard
- `apps/web/src/app/leaderboard/page.jsx` — graduation stage column added to table

#### T17 — /me Page Onboarding Progress
- `apps/web/src/app/me/page.jsx` — onboarding progress section added below graduation ladder

#### T18 — Admin Page DB Table Counts
- `apps/web/src/app/admin/page.jsx` — new "DB Persistence Health" section
- Fetches from `GET /api/v1/admin/db-health`

#### T19 — ISO 20022 Events Page
- `apps/web/src/app/iso20022/page.jsx` — new page listing recent ISO 20022 events

#### T20 — Sybil Decisions Count in Health
- Health detailed: sybil decisions count surfaced via `_v115.sybilResistance.listFlagged()`

#### T21 — DB Migration Phase 13
- `db/migration_phase13.sql` — three new additive tables

#### T22 — CHANGELOG_V117.md
- This file

#### T23 — MIGRATION_NOTES_V117.md
- `MIGRATION_NOTES_V117.md` — operator guide for V116 → V117

#### T24 — V117_NEXT_SESSION_PROMPT.md
- Next session handoff for V118

#### T25 — UPDATED_CLAUDE_CONTEXT.md
- State updated to V117, test count, new files listed

### LOW

#### T26 — CLI Graduation Test
- `tests/v117CliGraduation.test.js` — tests graduation CLI command output parsing

#### T27 — Golden Task Library Expansion
- `lib/goldenTaskEngine.js` — 4 new golden tasks added (Legal Doc Review domain)

#### T28 — README Update
- `README.md` — V117 section added to changelog table

#### T29 — WCAG 2.2 Accessibility Notes
- `docs/WCAG_ACCESSIBILITY_NOTES.md` — audit findings for apps/web pages

#### T30 — SDK Types Expanded
- `sdk/types.d.ts` — P12 and V117 types added to EcosClient interface

#### T31 — OpenAPI Spec Update
- `docs/openapi.json` — version bumped to 117.0.0, V117 endpoints added

#### T32 — Demo Seed Script
- `scripts/seed-demo.js` — Insurance Claims demo with realistic data

#### T33 — V117 Integration Tests
- `tests/v117Integration.test.js` — E2E tests for validator dashboard and ISO 20022 wiring

---

## New Files

| File | Purpose |
|------|---------|
| `db/migration_phase13.sql` | V117 schema (3 new tables) |
| `docs/CHANGELOG_V117.md` | This file |
| `docs/WCAG_ACCESSIBILITY_NOTES.md` | WCAG 2.2 audit findings |
| `MIGRATION_NOTES_V117.md` | V117 operator guide |
| `V117_NEXT_SESSION_PROMPT.md` | Next session handoff |
| `tests/v117version.test.js` | Version assertion |
| `tests/v117PersistenceExtended.test.js` | P12 persistence round-trips |
| `tests/v117IsoWiring.test.js` | ISO 20022 wiring endpoint tests |
| `tests/v117ValidatorDashboard.test.js` | Validator dashboard tests |
| `tests/v117CliGraduation.test.js` | CLI graduation command tests |
| `tests/v117Integration.test.js` | E2E integration tests |
| `scripts/seed-demo.js` | Demo data seeder |
| `apps/web/src/app/validator-dashboard/page.jsx` | Validator dashboard page |
| `apps/web/src/app/iso20022/page.jsx` | ISO 20022 events page |

## Modified Files

| File | Change |
|------|--------|
| `package.json` | Version 117.0.0, demo:seed script |
| `ecos-api-server.js` | _v116 IIFE: 10 new endpoints |
| `ecos-cli.js` | graduation command |
| `sdk/types.d.ts` | P12 + V117 types |
| `lib/goldenTaskEngine.js` | 4 new golden tasks (legal domain) |
| `apps/web/src/app/leaderboard/page.jsx` | Graduation stage column |
| `apps/web/src/app/me/page.jsx` | Onboarding progress section |
| `apps/web/src/app/admin/page.jsx` | DB persistence health section |
| `docs/openapi.json` | Version 117.0.0, V117 endpoints |
| `README.md` | V117 entry in changelog |

---

## Sacred Files — UNCHANGED

| File | MD5 |
|------|-----|
| `lib/fiatLedger.js` | `563e9b1f9e67091a5b6527c0a92568e5` |
| `lib/auditLog.js`   | `e5a5c2c27801d2d03991bc8e5a1df8cb` |

---

*ECOS CHANGELOG_V117.md · V116 → V117 · 2026-05-29*
