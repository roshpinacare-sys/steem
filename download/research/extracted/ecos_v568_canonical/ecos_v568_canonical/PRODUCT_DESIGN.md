# ECOS Product Design — V111 Sovereign Economy

## First-Run Experience

The goal: signup → 100 free credits → first task in under 60 seconds.

**Step 1: Landing page** (`/`)
The hero communicates the three-part value proposition before the user scrolls: USE (free), VERIFY (earn), OWN (royalties forever). No jargon. Live economy stats. One CTA: "Start free — 100 ⊙ on signup."

**Step 2: Signup** (`POST /api/v1/users/signup`)
Email + display name. Optional referral code. Instantly receives 100 ⊙ free-tier credits. Gets their own referral code. No credit card prompt, ever, on the signup screen.

**Step 3: Wallet** (`/wallet`)
First stop after signup. Balance shown large. Free-tier status visible. Available payment rails listed — including Manual and Bank Transfer for regions where Stripe doesn't work. The message is clear: "you have credits, you can start now."

**Step 4: First task**
The user sees what 1 ⊙ buys (one AI task). They run it. Either it settles automatically (70%+ confidence) or it enters the HITL queue (50–70%). Either way, the result is real.

**Time to value: < 60 seconds from landing page to first task result.**

---

## The Earning Loop

This is the core retention mechanic. Each stage naturally leads to the next.

```
USE          →  VERIFY        →  OWN
(spend ⊙)       (earn ⊙)         (royalties ⊙ forever)
1 ⊙ per task    5 ⊙ per review   10% of each downstream task
```

**Why this loop works:**
- USE is the entry point. Everyone starts here. Credits are free, so the barrier is zero.
- VERIFY is the first earning opportunity. Users who run tasks and see uncertain results naturally wonder "can I verify?" The answer is yes, and it pays.
- OWN is the hook that makes ECOS different from any other platform. Not a one-time payment — a royalty stream. Users who author patches become stakeholders.

**The psychology:** the loop creates a natural progression. New users spend credits. Active users earn credits. Expert users earn royalties. There's always a next step, and each step is more rewarding than the last.

---

## The Ownership Psychology

> "You own 3.2% of the ECOS knowledge base."

This is more powerful than "you earned $5." Here's why:

**Ownership is a different category of motivation than payment.** Payment is transactional: you do work, you get paid, the relationship ends. Ownership is ongoing: your contribution is *still there*, still working, still earning. It creates identity, not just income.

**Specific numbers compound the effect.** "3.2%" is more powerful than "some percentage" because it feels real, measurable, and yours. Users can compare their share over time, watch it grow, and feel it diminish if they stop contributing.

**The ownership snapshot** (GET `/api/v1/users/:id/ownership`) shows:
- Patches authored (count of contributions)
- Lifetime royalties earned (total ⊙ from reuse)
- Royalties last 7 days (recent momentum)
- Estimated annual royalties (the big number — "this is what your knowledge base is worth annually")
- Share of knowledge base (%) (the ownership percentage)
- Message: "Your knowledge has been reused N times this week"

**Why this works psychologically:**
1. *Progress visibility*: users can watch their share grow with each patch
2. *Perpetual reward*: royalties keep coming after the work is done (feels like passive income)
3. *Social comparison*: the leaderboard ranks by royalties, making high earners visible
4. *Loss aversion*: once users have a nonzero share, they're motivated to protect and grow it

---

## Community Mechanics

### Levels (Ownership-framed titles)
1. **Observer** — newcomer, exploring the system
2. **Contributor** — has completed tasks and validations
3. **Validator** — regular verifier, building reputation
4. **Steward** — experienced validator, helping maintain quality
5. **Architect** — patch author with royalties, shaping the knowledge base
6. **Founder-tier** — prolific contributor, stakeholder in the economy

Note: titles are *ownership-framed*, not just competence-framed. "Steward" and "Architect" suggest responsibility and authorship, not just skill level. "Founder-tier" is deliberately aspirational — it signals that early, high-contribution members are co-creators of the platform.

### Badges
Milestones that mark transitions, not just achievements:
- **first_validation**: the moment a user becomes a contributor
- **patch_earning_royalties**: the moment a user becomes a stakeholder
- **7_day_streak**: signals commitment and habit formation
- **100_credits_earned**: the moment passive income becomes real

Badges are shown on the Me page as a grid of unlocked/locked icons. Locked badges serve as goals — users know exactly what to do next.

### Streaks
Consecutive active days. The primary retention hook for daily engagement.
- A breaking streak is a loss-aversion trigger
- "You're on a 6-day streak — come back tomorrow to keep it going" is more powerful than "here's a reminder"
- Longest streak is preserved even when the current streak breaks — gives users a personal record to beat

### Referral System
- Each user gets a unique referral code on signup
- When a referee completes their first real action (task or validation), BOTH parties earn 25 ⊙
- Anti-abuse: bonus is held until first action, not given on signup
- The mechanic: "Invite → you both get 25 ⊙" is a clear, mutual benefit proposition

### Leaderboard
Three sorting modes: by royalties, by validations, by level.
- Royalties leaderboard: makes high-earning patch authors visible and aspirational
- Validations leaderboard: rewards high-volume validators
- Level leaderboard: rewards breadth of contribution

---

## Free-Tier Strategy

**Generous enough to hook. Structured so power users naturally graduate.**

The free-tier grant (100 ⊙ on signup) covers:
- 100 basic AI tasks (at 1 ⊙ each), OR
- 20 human-verified tasks (at 5 ⊙ each), OR
- 10 priority verifications (at 10 ⊙ each)

This is enough to meaningfully experience the system. Users who find value will want more. The path to "more" is:
1. **Earn by validating** — the most natural path; users who run tasks see uncertain results, try validating, earn credits
2. **Earn by authoring** — users who validate well graduate to patch authorship and royalties
3. **Buy with a rail** — users who want more than they can earn can top up via any available payment rail (Manual, Bank, Stripe)

**The free-tier refills monthly** — keeping users who are earning just below their usage from leaving. Monthly free credits create a recurring reason to return.

---

## Retention Hooks and Their Psychology

| Hook | Targets | Mechanism |
|------|---------|-----------|
| 100 ⊙ free on signup | Acquisition | Zero-friction first experience; everyone can start |
| Streak counter | Daily habit | Loss aversion; users don't want to break a streak |
| Level progression | Progress motivation | Visible progress toward a named milestone |
| Ownership % | Identity | "This is mine; I have a stake in this system" |
| Royalty earnings | Passive income fantasy | "My past work is still earning while I sleep" |
| Referral bonuses | Social proof | "My friends are here; we're in this together" |
| Badges | Milestone completion | Clear goals; visible achievements |
| Leaderboard | Social competition | "I want to be known as a top validator/patch author" |
| Monthly free-tier refill | Retention / churn prevention | "There's always a reason to come back this month" |
