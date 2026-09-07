# ECOS Graduation Loop — Growth Model
*V114 Research Integration, May 29, 2026*

## The Core Model: Roblox + Braintrust Applied to AI Validation

The graduation loop makes ECOS different from every other AI validation platform:
users don't just earn once — they compound into ownership.

```
USE (spend) -> VERIFY (earn) -> OWN (royalties forever) -> RECRUIT (refer + earn)
     |                                                             |
     +--------- Each stage: users teach & recruit next cohort ----+
```

---

## The Four Stages

### Stage 1: USE (Entry — Zero Friction)
- Free 100 credits on signup, no credit card
- Duolingo-style: streaks, XP, daily missions tied to real micro-earnings
- 1 credit per auto-flow task, 5 credits per human-verified task

### Stage 2: VERIFY (First Earning)
- Complete first validation -> 10 credit bonus
- Beginner path: AI scaffolding + senior review safety net
- Expert path: full tooling, higher rates
- Reputation score starts building

### Stage 3: OWN (The Hook)
- Author a knowledge patch -> earn 10% royalty on every future reuse, forever
- Ownership snapshot: "You own 3.2% of the ECOS knowledge base"
- This is Jaron Lanier's "data dignity" made operational

### Stage 4: RECRUIT (Viral Loop)
- Referral code: bring a user -> 25 credit bonus when they complete first task
- Mentor tier: senior validators earn referral bonuses for sponsoring junior validators
- Community ownership: governance rights at Architect tier (V115+)

---

## Graduation Ladder

| Level | Title | Trigger | Bonus |
|---|---|---|---|
| 1 | Observer | Signup | 100 free credits |
| 2 | Contributor | 10 validations | +10 credits |
| 3 | Validator | 50 validations + first patch | +25 credits |
| 4 | Steward | 200 validations + 10 patches | Revenue share unlock |
| 5 | Architect | 1,000 validations | Governance rights (V115+) |
| 6 | Founder-tier | 5,000 validations | Profit share (V116+) |

---

## Proven Benchmarks

| Platform | Key Metric |
|---|---|
| Roblox DevEx | Median $1,575/yr; top-1,000 avg $820K/yr; $1B+ paid Mar 2024-Mar 2025 (31% YoY) |
| Braintrust | ~50% acquisition from referrals; cost "nearly zero"; $3.5M -> $31M GSV in 12 months |
| Stocksy | $24.7M+ to ~1,000 artists; far higher retention than Getty/Shutterstock |
| Duolingo | Churn 47% (2020) -> 28% (2026); DAUs 10x since 2019 |

**Key Roblox insight:** 33% of DevEx creators had never taken a CS class; 44% wouldn't have
built anything without Roblox. The graduation model creates creators from non-creators.

---

## The Anti-Token Rule

BTRST (Braintrust token) collapsed ~99.8% from 2021 high (~$41-49 -> ~$0.07).

ECOS must NOT launch a speculative token. The ownership hook:
- Reputation score (public, verifiable, portable)
- Royalty streams (real earnings, not speculative)
- Profit-sharing agreements (contractual)
- Cooperative equity (legal entity, not blockchain)

---

## Implementation

`lib/graduationEngine.js` implements the stage transition logic.
`lib/engagementEngine.js` implements levels, badges, streaks, ownership snapshot.
Wire `GET /api/v1/users/:id/graduation` in V115 using GraduationEngine.
