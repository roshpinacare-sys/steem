# ECOS V128 — Changelog
**Release Name:** Constructive Collaboration  
**Date:** 2026-05-30  
**Base:** V127 — Global First (~1132 tests, 59 libs, 20 pages)  
**Tests:** ~1132 (V127) + ~27 new V128 = **~1159 passing**  
**Libraries:** 59 → **62** (new: globalBridgeNetwork.js, collaborationEngine.js, globalLimitResolver.js)

---

## Strategic Shift — V128

**V127 mapped regulations globally. V128 enables global users to actually work together.**

Three core problems solved:

1. **Limits are dead-ends** → V128 turns every regulatory/technical limit into a routing
   problem with at least one practical alternative.

2. **Collaboration collapses across borders** → V128 introduces a `GlobalBridgeNetwork`
   that resolves jurisdiction constraints and finds the most permissive collaboration mode
   that satisfies both parties' rules.

3. **No way to distinguish constructive from destructive user interaction** →
   V128 tracks and rewards constructive collaboration (peer review, mentorship,
   knowledge exchange) while surfacing destructive patterns (sybil rings, collusion)
   to existing defense systems.

---

## What's New

### [V128-C01] Global Bridge Network (`lib/globalBridgeNetwork.js`)

Cross-border collaboration infrastructure:

- **`ConstraintResolver`** — for any two jurisdictions, returns what collaboration
  is possible and at what level (direct / proxied / async-only)
- **`TrustBond`** — accumulated trust between user pairs; builds from interactions,
  not from identity claims; tiers: new → acquainted → familiar → trusted
- **`CollaborationSession`** — bounded, audited joint-work context with graceful
  mode downgrade when restrictions apply
- **`BridgeNode`** — singleton managing all sessions and bonds

Key principle: **collaboration is never blocked — only routed differently.**

```javascript
const { bridgeNode } = require('./lib/globalBridgeNetwork');

// EU user and Singapore user want to collaborate
const session = bridgeNode.startSession({
  initiator: 'user-eu-123',
  invitee:   'user-sg-456',
  mode:      'co-validation',     // may be auto-downgraded to 'review' if restricted
  jurisdictionA: 'eu',
  jurisdictionB: 'singapore',
  topic: 'Insurance claims AI review',
});

// Contribute to the session — every contribution builds trust
bridgeNode.contribute(session.sessionId, 'user-eu-123', 'review', 'looks good, minor concerns on p3');

// Close and get summary + updated trust bond
const { summary, bond } = bridgeNode.closeSession(session.sessionId, 'completed');
// bond.tier: 'acquainted' → next session → 'familiar' → ...
```

**New API endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/bridge/sessions` | Start collaboration session (mode auto-resolved) |
| GET  | `/api/v1/bridge/sessions` | List user's sessions |
| POST | `/api/v1/bridge/sessions/:id/contribute` | Add contribution |
| POST | `/api/v1/bridge/sessions/:id/close` | Close session |
| GET  | `/api/v1/bridge/bonds/:userId` | Trust bonds for a user |
| GET  | `/api/v1/bridge/constraints` | Constraint resolution for two jurisdictions |
| GET  | `/api/v1/bridge/stats` | Bridge network statistics |

---

### [V128-C02] Collaboration Engine (`lib/collaborationEngine.js`)

Tracks and rewards constructive interactions; surfaces destructive ones.

**Constructive types** (rewarded with score gain):
- `peer_review` — validator reviews peer's work
- `knowledge_exchange` — domain expertise shared across teams
- `co_validation` — joint resolution of high-stakes missions
- `template_collab` — joint authorship of agent templates
- `mentorship` — senior guides junior validator

**Destructive signals** (score penalty + routed to sybilResistance):
- `sybil_ring` — coordinated identity gaming
- `collusion` — validators coordinating approvals
- `review_bombing` — coordinated negative-review attacks
- `vote_manipulation` — coordinated voting

**Pair assessment** — for any two users, engine assesses interaction history:
- Diverse collaboration types → healthy
- High destructive ratio → flagged

```javascript
const { collaborationEngine, COLLABORATION_TYPES } = require('./lib/collaborationEngine');

collaborationEngine.record({
  type: COLLABORATION_TYPES.PEER_REVIEW,
  participants: ['validator-a', 'validator-b'],
  outcome: 'constructive',
  context: { missionId: 'mission::abc' },
});

collaborationEngine.leaderboard(10);  // top 10 most constructive
collaborationEngine.assessPair('validator-a', 'validator-b');  // { risk: 'low', status: 'diverse' }
```

**New API endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/collaboration/record` | Record collaboration event |
| GET  | `/api/v1/collaboration/leaderboard` | Constructive collaboration leaderboard |
| GET  | `/api/v1/collaboration/stats` | Global collaboration statistics |
| GET  | `/api/v1/collaboration/assess` | Assess a user pair (risk level) |

---

### [V128-C03] Global Limit Resolver (`lib/globalLimitResolver.js`)

For every regulatory or technical constraint, at least one constructive path forward.

Limits catalogued:
- `payment:no-stripe` — Stripe unavailable in jurisdiction
- `payment:currency-blocked` — local currency unsupported
- `data:cross-border-blocked` — data residency requirement
- `data:ai-restricted` — AI inference restricted on certain data
- `identity:pseudonym-required` — real identity can't cross border
- `collab:no-live-session` — live sessions restricted
- `rate:deposit-limit` — deposit rate limited

Every limit includes:
- Which jurisdictions are affected
- Severity (high / medium / low)
- 2+ alternatives with ECOS API paths
- Estimated effort (none / low / medium)

```javascript
const { globalLimitResolver } = require('./lib/globalLimitResolver');

// User in EU can't use Stripe — what can they do?
const limit = globalLimitResolver.resolve('payment:no-stripe');
// → { alternatives: [ManualRail, CreditAccumulation], ecosPath: ... }

// Two users want to collaborate — what limits and alternatives exist?
const analysis = globalLimitResolver.crossBorderAnalysis('eu', 'india');
// → { canCollaborate: true, limits: [...], allAlternatives: [...] }
```

**New API endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/limits/catalog` | All known limits with severity + count |
| GET | `/api/v1/limits/resolve/:id` | Full limit details + alternatives |
| GET | `/api/v1/limits/cross-border` | Cross-border limit analysis for jurisdiction pair |
| GET | `/api/v1/limits/applicable` | Limits for a specific jurisdiction |

---

## Tests Added

| File | Tests | Coverage |
|------|-------|---------|
| `tests/v128BridgeNetwork.test.js`         | 10 | ConstraintResolver modes, TrustBond accumulation + cap, session lifecycle, mode downgrade, session listing |
| `tests/v128CollaborationEngine.test.js`   | 8  | constructive/destructive scoring, flagDestructive, assessPair, leaderboard sort, stats, type validation |
| `tests/v128GlobalLimitResolver.test.js`   | 8  | resolve known/unknown, findLimits by jurisdiction/category, crossBorderAnalysis, catalog completeness |

---

## Architecture (V128)

```
Client
  └─ POST /chat|/task
       └─ pressureDetector → confidenceGate
            ├─ BLOCK      → reject
            ├─ HITL_QUEUE → [collaborationEngine.record] → validator → fiatLedger★ → auditLog★
            └─ AUTO_FLOW  → fiatLedger★ → auditLog★

POST /api/v1/bridge/*          ← V128: cross-jurisdiction collaboration sessions + trust bonds
POST /api/v1/collaboration/*   ← V128: constructive/destructive event tracking + leaderboard
GET  /api/v1/limits/*          ← V128: every global limit → practical alternatives
```

---

## Sacred Files — Unchanged

```
lib/fiatLedger.js    MD5: 563e9b1f9e67091a5b6527c0a92568e5  ✅
lib/auditLog.js      MD5: e5a5c2c27801d2d03991bc8e5a1df8cb  ✅
```

---

## What's Next (V129)

1. **First paying customer** — Stripe live + public demo (carried from V128 roadmap)
2. **Validator login flow** — replace NEXT_PUBLIC_VALIDATOR_TOKEN
3. **Bridge UI** — apps/web collaboration session page
4. **GDPR Art. 17** — legal opinion on pseudonymization
5. **Israel IIA grant application** — apply with V128 collaboration story
