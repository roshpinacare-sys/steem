# ECOS Collaboration Architecture — V128
*P19 — Constructive Collaboration · 2026-05-30*

## Philosophy

**Limits are routing problems, not dead-ends.**

Every regulatory constraint between two users has at least one constructive path forward.
ECOS V128 makes this explicit in code: the `GlobalLimitResolver` guarantees
`canCollaborate: true` for every jurisdiction pair.

**Collaboration is audited, not assumed.**

Every collaboration session is logged. Every trust bond is built from observed interactions,
not self-reported identity. Destructive patterns (sybil rings, collusion) are surfaced
to existing defense layers automatically.

---

## Three-Layer Collaboration Model

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: CONSTRAINT RESOLUTION (globalBridgeNetwork.js)     │
│  "What collaboration is possible given these two countries?" │
│  → ConstraintResolver → mode: direct | proxied | async      │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: SESSION MANAGEMENT (globalBridgeNetwork.js)        │
│  "Run the actual collaboration, build trust along the way"  │
│  → CollaborationSession → contributions → TrustBond         │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: BEHAVIORAL TRACKING (collaborationEngine.js)       │
│  "Is this pair constructive or destructive over time?"      │
│  → CollaborationEvent → score → leaderboard / sybilFlag     │
└─────────────────────────────────────────────────────────────┘
```

Plus:
```
┌─────────────────────────────────────────────────────────────┐
│  LIMIT CATALOG (globalLimitResolver.js)                     │
│  "User hit a wall — here are the paths around it"           │
│  → crossBorderAnalysis → alternatives[] with ecosPath       │
└─────────────────────────────────────────────────────────────┘
```

---

## Collaboration Modes (by restrictiveness)

| Mode | Allowed When | What Crosses Border |
|------|-------------|---------------------|
| `identity-verified-session` | No pseudonym requirement on either side | Full interaction |
| `live-session` | CrossBorder not restricted on either side | Data + identity (pseudonymized if needed) |
| `co-validate` | CrossBorder permitted | Task outcomes only |
| `knowledge-exchange` | Always | Anonymized patterns only |
| `review` | Always | Structured review artifact |
| `template-share` | Always | Logic only (no data) |

Mode is **automatically selected** — the BridgeNode picks the most permissive mode
that satisfies both jurisdictions. Users are never blocked; they are routed.

---

## Trust Bond Model

Trust builds from observed behavior, not claims:

| Event | Trust Delta |
|-------|------------|
| contribution to session | +3 |
| session completed | +10 |
| destructive signal flagged | −20 |

Bond tiers:
- **new** (0–19): first encounter; template/review modes only
- **acquainted** (20–49): unlocks knowledge-exchange + async co-validation
- **familiar** (50–79): unlocks live-session (subject to jurisdiction)
- **trusted** (80–100): full collaboration suite; validator quorum eligible

---

## Constructive vs Destructive Signals

### Constructive (rewarded)
| Type | Description |
|------|-------------|
| `peer_review` | Validator reviews peer's work independently |
| `knowledge_exchange` | Domain expertise shared explicitly |
| `co_validation` | Joint resolution with both parties' independent judgment |
| `template_collab` | Joint authorship of reusable agent template |
| `mentorship` | Senior validator explicitly developing junior |

### Destructive (penalized + flagged)
| Signal | What It Looks Like |
|--------|-------------------|
| `sybil_ring` | Same IP / device pattern; mirror-image approvals |
| `collusion` | Always approve each other's submissions |
| `review_bombing` | Coordinated negative reviews of same target |
| `vote_manipulation` | Statistically impossible agreement rate |

Destructive flags are surfaced to `sybilResistance.js` for further action.

---

## API Quick Reference

```
# Start a cross-border session
POST /api/v1/bridge/sessions
{ initiator, invitee, mode, jurisdictionA, jurisdictionB, topic }
→ { sessionId, mode (may be downgraded), resolution }

# Contribute to session (builds trust bond)
POST /api/v1/bridge/sessions/:id/contribute
{ userId, type, content }
→ { contribution, bond }

# Check what's possible between two jurisdictions
GET /api/v1/bridge/constraints?a=eu&b=singapore
→ { crossBorderMode, allowedModes, pseudonymRequired }

# Find alternatives when a user hits a limit
GET /api/v1/limits/resolve/payment:no-stripe
→ { alternatives: [{ label, description, ecosPath, effort }] }

# Full cross-border limit analysis
GET /api/v1/limits/cross-border?a=eu&b=india
→ { canCollaborate: true, limits[], allAlternatives[] }

# Collaboration leaderboard
GET /api/v1/collaboration/leaderboard
→ [{ userId, score, constructive, destructive }]
```

---

*COLLABORATION_ARCHITECTURE.md · ECOS V128 · 2026-05-30*
