# ECOS AI Protocol — V214

**Version:** 214.0.0
**Phase:** P103
**Date:** 2026-05-31
**Status:** Active

---

## Purpose

This document defines the canonical AI operating protocol for ECOS V214.
Extends AI_PROTOCOL_V212.md with V214-specific contracts, rules, and the
**Research Tool Protocol** — mandatory pre-session research before any new version.

---

## 1. Immutable Rules (All Versions)

| Rule | Description |
|------|-------------|
| R1 | Sacred files (`lib/fiatLedger.js`, `lib/auditLog.js`) MUST NOT be modified. MD5-verify at session start. |
| R2 | All identifiers introduced in a version MUST be suffixed with the version number (e.g., `createPool214`). |
| R3 | Zero new npm dependencies. All logic uses Node.js built-ins or in-memory data structures. |
| R4 | All test exports go into the single `if (process.env.NODE_ENV === 'test')` block. |
| R5 | Version bump: `package.json` `version` field increments on each canonical ZIP. |

---

## 2. Research Tool Protocol (NEW — V214)

### 2.1 Mandatory Pre-Session Research

**Before starting any new version (V215+), the owner MUST:**

1. Open `src/research/researchTool214.jsx` in **claude.ai Artifacts** (or local React dev).
2. Click **"הרץ מחקר מעמיק"** — the tool calls `claude-sonnet-4-20250514` with `web_search_20250305`.
3. Wait 30–60 seconds for the JSON response to render across 7 tabs.
4. Review and extract relevant findings into the new `NEXT_SESSION_PROMPT_V21x.md`.

### 2.2 Research Output Contract

The tool returns a strict JSON with these fields (all required):

| Field | Type | Purpose |
|-------|------|---------|
| `oneliner` | string | ECOS one-line definition |
| `wedge` | string | Single 0→1 wedge |
| `first_customer` | string | First customer + Aha moment |
| `section_b` | array | Case studies 2024–2026 with source+date+number |
| `section_c` | object | Gen-Z psychology + onboarding flow |
| `section_d_layers` | array | 3 layers: 100 users → community → defensibility |
| `moves_v214_v218` | array | Strategic moves V214–V218 with rationale |
| `blind_spots` | array | 5–8 blind spots + this-week fix |
| `lessons_table` | array | Lesson / source / severity / ecos_apply / effort |
| `red_flags` | array | Red flags beyond the 5 in Economic Safety Monitor |

### 2.3 Integration with Session Workflow

```
researchTool214.jsx → JSON → owner filters → NEXT_SESSION_PROMPT_V21x.md → AI session
```

The AI (Claude) in the next session reads the filtered research findings
as part of its context and builds accordingly. Research findings are NOT
auto-applied — the owner decides what to implement.

---

## 3. V214-Specific Protocol

### 3.1 Economic Safety Monitor — Live Wiring

- `assess213` must be fed from real in-memory stores (ledger, rep, treasury).
- New endpoint: `GET /admin/health/economy` — cached snapshot, max staleness 60 seconds.
- Snapshot store: `_healthSnapshots214`, ring buffer of 100 entries.

### 3.2 Decay Enforcement Contract

- Effective voting weight: `effectiveVoteWeight = nominaRep × (1 - decayFactor214)`.
- `decayFactor214` = days-since-last-task × `DECAY_RATE_PER_DAY_214` (0.015).
- Royalty share reduction: same `decayFactor214` applied proportionally.
- Computed on-demand — no separate store update needed.

### 3.3 Stablecoin-Only Payout Guard

- Any payout where `payoutType === 'executor' || payoutType === 'connector'` MUST have `currency` in `['USDC', 'USDT', 'DAI', 'EURC']`.
- Native token (`ECO`) allowed only for staking deposits.
- Guard function: `assertStablecoinPayout214(currency, payoutType)` → throws `STABLECOIN_GUARD_214` if violated.

### 3.4 Sybil Gate Contract

- Tasks with `valueUSD >= SYBIL_MIN_VALUE_214` (default: $1.00) require `sybilVerified: true` on workspace.
- Verification: aged social link (Twitter/GitHub OAuth, age ≥ 30 days) OR World ID nullifier.
- Gate: `assertSybilGate214(workspaceId, valueUSD)` → throws `SYBIL_GATE_214` if not verified.
- Verification endpoint: `POST /workspaces/:id/sybil-verify`.

---

## 4. Endpoint Naming Conventions (V214)

All V214 endpoints follow the established pattern:
- Variable names: `req214<letter>`, `res214<letter>`, `err214<letter>`.
- Sequential suffix letters: `a` = first endpoint, continuing alphabetically.
- Admin summary uses letter `z`.

---

## 5. In-Memory Store Sizes (V214 Limits)

| Store | Variable | Max Size |
|-------|----------|----------|
| Health Snapshots | `_healthSnapshots214` | 100 (ring) |
| Sybil Verifications | `_sybilVerified214` | 50,000 |
| Decay Cache | `_decayCache214` | 10,000 (TTL 5min) |
