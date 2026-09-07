# CHANGELOG — ECOS V208 (Phase P97)

**Date:** 2026-05-31  
**Version:** 208.0.0 (→ from 207.0.0)  
**Phase:** P97  
**Research sources:** 2 strategy PDFs (failure autopsy + BIM/competitive analysis)

---

## What changed

### New library files (6)

| File | Purpose | Research source |
|------|---------|-----------------|
| `lib/reputationDecayEngine208.js` | Exponential decay `R(t)=R₀×e^(−λt)`, Gini, RII | Colony/Build Finance rent-seeking analysis |
| `lib/economicHealthMonitor208.js` | 4 red-flag metrics with exact thresholds | FTX/Terra/Celsius/3AC autopsy |
| `lib/workStreakEngine208.js` | Duolingo-style streak + freeze mechanic | Duolingo loss-aversion/Zeigarnik analysis |
| `lib/systemCapabilities208.js` | 17 capability domains + guided actions + onboarding + Sybil | Wedge/retention strategy analysis |
| `lib/agentConsensusEngine208.js` | BIM tolerance-aware consensus (NED + cosine + Jaccard) | BIM specification — PDF #2 |
| `lib/diversityRouter208.js` | Rendezvous hashing + collusion detection | BIM diversity routing — PDF #2 |

### New endpoints (13)

```
GET  /api/v1/system/capabilities/:domainId       — Per-domain capability detail
GET  /api/v1/system/guided-actions               — Chat-first action catalog (filterable)
GET  /api/v1/workspaces/:id/onboarding/score     — Onboarding health score 0-100
GET  /api/v1/system/economic-health              — 4 red-flag metrics + status
GET  /api/v1/workspaces/:id/streak               — Current streak state + at-risk flag
POST /api/v1/workspaces/:id/streak/record        — Record task activity (anti-hollow gate)
POST /api/v1/workspaces/:id/streak/freeze        — Purchase streak freeze with XP
GET  /api/v1/workspaces/:id/reputation/decay-preview — Effective rep + projections
POST /api/v1/workspaces/:id/sybil-check          — 5-factor Sybil risk score
POST /api/v1/agent/consensus                     — BIM agent output consensus
POST /api/v1/tasks/route-reviewer                — Diversity-aware reviewer assignment
POST /api/v1/tasks/collusion-check               — Batch collusion risk analysis
GET  /api/v1/admin/summary/v208                  — Full V208 admin summary
```

### Files modified

- `ecos-api-server.js` — 6 new require() blocks at top + 13 endpoints at bottom + 24 test exports
- `package.json` — version 207.0.0 → 208.0.0, description updated

### Files NOT modified (R1 sacred rule)

- `src/lib/fiatLedger.js` ✅ MD5 unchanged
- `src/lib/auditLog.js` ✅ MD5 unchanged

---

## Economic guardrails implemented

Based on research failure autopsy (PDF #1) and BIM spec (PDF #2):

1. **No protocol token as wage** — USDC/ETH only for 40%+20% payments (FTX/Terra lesson)
2. **Exponential reputation decay** — λ=0.015/day, half-life 46 days (Colony rent-seeking lesson)  
3. **Governance quorum ≥65%** — dynamic threshold prevents takeover (Build Finance lesson)
4. **Treasury ≥50% liquid** — USDC/ETH ratio tracked in real-time (Celsius lesson)
5. **Hollow task gate** — tasks <30s don't extend streak or award XP (Coordinape lesson)
6. **AI agent cap $20** — human-in-the-loop above this threshold (Ledger Security 2026)
7. **BIM consensus** — NED/cosine/Jaccard before payment release (BIM spec)
8. **Diversity routing** — same-ASN/subnet/OS reviewer blocked by rendezvous hash (BIM spec)

---

## V207 backward compatibility

All V207 exports preserved in the shared `NODE_ENV===test` block:
- `_buildCapabilityMap207`, `_detectBursts207`, `BurstValidationError207`, `_capDomains207`
- `V206_DEFAULT_LIMIT`, `V206_MAX_LIMIT`
- `V187_BULK_SET_MAX`, `V188_BOOKMARK_BULK_DELETE_MAX`, `V188_BULK_CLEAR_V2_MAX`

All V207 endpoints (`/api/v1/system/capabilities`, `/api/v1/workspaces/:id/events/digest/burst`, `/api/v1/admin/summary/v207`) preserved exactly.
