# NEXT_SESSION_PROMPT_V215.md — Start of V215 (Phase P102)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v215_canonical.zip` (root `ecos_v215_canonical/`). **קרא `CLAUDE.md` ראשון** — הוא מסכם את כל המבנה.

## State at V214
- `ecos-api-server.js` parses clean; version 214.0.0; Phase P101 complete.
- V212 added: Validator Pool Staking, Proof Attestation, Calibration Routing, Reputation Decay Insurance, Governance Execution, Multi-Round Consensus.
- Event digest suite complete: gap detection, velocity, top-senders, type-distribution, heatmap, type-timeline, cross-tab, peak-hour.
- Economic Safety Monitor active: faucet/sink, reputation-inflation, gini, hollow-task-rate, treasury-liquidity.
- **New in this ZIP:** `artifacts/` folder with `ecosNavigator215.jsx` + `researchTool215.jsx` — two React artifacts ready to paste into Claude.

## ⚠️ Pre-flight (do FIRST, every session)
> קבצי `ecos-api-server.js` ו-`tests/` נמצאים בסביבת הפיתוח המלאה. ה-ZIP הזה מכיל: libs, artifacts, sdk, docs.
```
node --check ecos-api-server.js          # must print nothing
NODE_ENV=test node tests/v214.test.js    # must pass all
NODE_ENV=test node tests/v215.test.js    # V215 suite
md5sum src/lib/fiatLedger.js src/lib/auditLog.js # 563e9b1f… / e5a5c2c2…
```
- `Identifier '...' has already been declared` → suffix new identifiers `…215` (BUG-L).

## Invariants
- R1 sacred files immutable · R4 no endpoint removal · R5 all prior suites pass ·
  R6 zero new npm deps · R8 NODE_ENV=test exports + version-suffixed identifiers.

## Chain notes for V215
- Event digest service: `_eventDigest191`. Event log: `_eventLog181`. Do NOT create parallel stores.
- Broadcast: `_broadcast179`. Bookmarks: `_bookmarks184`. Snapshots: `_statsSnapshots185`. Tokens: `_tokenSvc181`.
- Pools: `_pools212`. Attestations: `_attestations212`. Route log: `_routeLog212`. Insurance: `_policies212`. Exec log: `_execLog212`. Rounds: `_rounds212`.
- V215 introduces: agent micro-escrow (`_escrows215`), sybil resistance score (on-demand), onboarding funnel log (`_onboardLog215`).
- New endpoints begin at V215-T01.

## Suggested P102 work (V215)
1. **V215-T01** Agent micro-escrow hold: `POST /workspaces/:id/agent-escrow` — hold amount for (agentId, taskId), return escrowId + expiry.
2. **V215-T02** Agent micro-escrow release: `POST /workspaces/:id/agent-escrow/:escrowId/release` — release to agent on signature match.
3. **V215-T03** Sybil resistance score: `GET /workspaces/:id/members/:uid/sybil-score` — return composite 0.0–1.0 score + component breakdown.
4. **V215-T04** Onboarding funnel log: `POST /workspaces/:id/onboard/:sessionId/step` — log step + timestamp, return funnel state.
5. **V215-Tz** Admin summary V215.

## 🎨 Artifacts (חדש ב-V215)
שני קבצים ב-`artifacts/`:
- `ecosNavigator215.jsx` — הדבק ב-Claude כ-React artifact לקבל Dashboard.
- `researchTool215.jsx` — הדבק ב-Claude כ-React artifact לקבל כלי מחקר AI-powered.
  - אחר כך שלח את `docs/RESEARCH_PROMPT_V2.md` כ-query לכלי.
