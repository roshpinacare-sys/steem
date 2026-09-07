# ECOS Changelog — V133: Production Hardening II + Rank & Rewards

**Release Date:** 2026-05-30
**Version:** 133.0.0
**Release Name:** Production Hardening II + User Rank & Rewards

---

## Overview

V133 delivers two work streams:

**P23 — Production Hardening II** completes the four tickets deferred from V132:
auto-registration of the default consensus provider, an interactive consensus form
in the Sovereign Dashboard, sovereign stats wired into the health endpoint, and
rate limiting on the expensive consensus endpoint.

**[V133-RANK] — User Rank & Reward Eligibility System** introduces a structured,
exclusive tiered reward system — rewards are not open to all, they are earned.

---

## P23: Production Hardening II

### [V133-PH-01] Consensus Provider Auto-Registration
The `EcosOfflineAdapter` (from `lib/intelligenceRegistry.js`) is now registered
as the default consensus provider at server startup. `POST /api/v1/inference/consensus`
is functional immediately — no manual registration needed in dev/staging environments.

### [V133-PH-02] Consensus UI in Sovereign Dashboard
The Sovereign Dashboard now includes a prompt input form that submits to
`POST /api/v1/inference/consensus` and renders results inline:
winner output, quorum percentage, dissent flag, number of votes, and the chain hash.

### [V133-PH-03] Sovereign Stats in Health Endpoint
`GET /api/v1/health` now includes a `sovereign` block with:
- `totalInferences` — from `sovereignAILedger.stats()`
- `totalTranslations` — from `sovereignAILedger.stats()`
- `consensusTotalRuns` — from `aiValidatorConsensus.stats()`
- `consensusProviders` — list of registered provider IDs

### [V133-PH-04] Rate Limit Consensus Endpoint
`POST /api/v1/inference/consensus` now has per-IP rate limiting:
10 requests per minute. Returns 429 + `X-RateLimit-Limit/Remaining/Reset` headers.

---

## [V133-RANK] User Rank & Reward Eligibility System

### Philosophy
> The reward system is not trivial and is not meant for everyone.
> There are structured tiers for users, a unique token, and a system ranking.
> Rewards are not directly offered — they are for the select few identified by the system.
> To avoid scams and spam, communication itself is also ranked,
> with access levels and entry gated by tier.

### Tier Ladder

| Tier | Emoji | Min Score | Reward Eligible | Multiplier | Comm Level |
|------|-------|-----------|-----------------|------------|------------|
| Observer    | 👁️ | 0     | ✗ | 0×   | 0 — None |
| Member      | 🌱 | 50    | ✗ | 0×   | 1 — Basic |
| Contributor | ⚡ | 200   | ✓ | 1×   | 2 — Community |
| Validator   | 🔐 | 600   | ✓ | 1.5× | 3 — Validator |
| Steward     | 🏛️ | 1500  | ✓ | 2×   | 4 — Governance |
| Sovereign   | 👑 | 5000  | ✓ | 3×   | 5 — Full |

### Score Events
Positive: `task_submitted` (+10), `task_approved` (+25), `validation_completed` (+20),
`validation_correct` (+15), `patch_authored` (+30), `patch_earning_royalty` (+50),
`referral_converted` (+40), `streak_7d` (+20), `streak_30d` (+60)

Anti-spam/anti-scam: `spam_flag` (−80), `scam_flag` (−200), `false_validation` (−30),
`rate_limit_abuse` (−15). Score cannot go below 0.

### RankToken
Each user has a deterministic, non-transferable token:
`RTK-{sha256(secret:userId:rank-token).slice(0,32).toUpperCase()}`
Verified via `POST /api/v1/rank/verify-token`.

### Communication Access Gating
| Level | Label | Channels |
|-------|-------|---------|
| 0 | None | — |
| 1 | Basic | public-announcements |
| 2 | Community | + community-general, contributor-hub |
| 3 | Validator | + validator-channel |
| 4 | Governance | + governance-chamber |
| 5 | Full | * (all) |

---

## New API Endpoints (8 total in V133)

| Method | Path | Description |
|--------|------|-------------|
| GET  | `/api/v1/rank/stats`                      | Tier distribution stats |
| GET  | `/api/v1/rank/tiers`                      | All tiers + score events |
| GET  | `/api/v1/rank/leaderboard`                | Top N users by score |
| GET  | `/api/v1/rank/log`                        | Recent tier change log |
| GET  | `/api/v1/rank/users/:userId`              | Rank profile for user |
| POST | `/api/v1/rank/users/:userId/event`        | Record score event |
| POST | `/api/v1/rank/verify-token`               | Verify a rank token |
| GET  | `/api/v1/rank/users/:userId/channels`     | Accessible comm channels |

---

## Invariants Preserved

1. ✅ `lib/fiatLedger.js` — NOT modified (sacred)
2. ✅ `lib/auditLog.js`  — NOT modified (sacred)
3. ✅ BigInt-only accounting
4. ✅ No new npm dependencies
5. ✅ All V132 endpoints preserved

---

## Tests

| File | Tests |
|------|-------|
| `tests/v133UserRankSystem.test.js`       | ~28 |
| `tests/v133ProductionHardening.test.js`  | ~8  |

**Expected total: ~1273 passing** (V132: ~1237 + V133: ~36)
