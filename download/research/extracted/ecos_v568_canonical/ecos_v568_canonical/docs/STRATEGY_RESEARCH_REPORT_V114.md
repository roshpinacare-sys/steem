# ECOS Strategy & Architecture: Turning AI Displacement Into a Trustworthy Human-AI Economy
## V114 Research Integration — May 29, 2026

## TL;DR
- **Build ECOS as the "trust layer for AI" that re-employs laid-off senior engineers as paid validators** — the strongest available positioning. Market: Mercor pays "$1.5M/day to 30,000 experts at $85/hr avg" (TechCrunch Oct 2025); Surge AI "in talks to raise $1B at $25B valuation" (Bloomberg Jul 2025); data labeling market "$3.77B (2024) → $17.10B (2030)" (Grand View Research). Incumbents are bleeding trust through pay disputes and mass terminations.
- **Sequence ruthlessly: closed-loop credits first (no MTL, no token), deterministic core + probabilistic edge AI leash, then regulated stablecoin rails (Bridge/BVNK) once you have paying demand.** BigInt ledger, SHA-256 audit chain, confidence gate, and knowledge-patch royalties are already the right primitives — map them onto NIST AI RMF, ISO 42001, OWASP Agentic Top 10, ISO 20022, FATF Travel Rule.
- **Growth = genuine user economic success + ownership, not token speculation: copy Roblox's graduation loop** (median DevEx creator $1,575/yr; $1B+ paid Mar 2024-Mar 2025; 31% YoY growth) **and Braintrust's ownership model** (0% talent fee vs. 20-40% incumbents).

---

## Key Findings

### 1. The Displaced-Worker Thesis Is Real and Timely
- Challenger Gray & Christmas 2025: AI "responsible for 54,836 announced layoff plans" in 2025 (71,825 total AI-cited since 2023).
- layoffs.fyi: 122,549-245,953 tech layoffs 2025; 144,832 already by early 2026.
- Tech unemployment: 5.8% early 2026 (highest since 2001-02 dot-com bust).
- Median reemployment time: 3.2 months (2024) → 4.7 months (2026).
- These workers earn premium rates at frontier labs: Surge AI pays medical fellows $250-450/hr; RLHF specialists $50-65/hr; Mercor avg $85/hr.
- **The ECOS mission: "the people AI replaced are now the people who make AI trustworthy."**

**Incumbent failures (ECOS's wedge):**
- Scale AI/Outlier: 500+ contractors terminated Aug 2024 (WARN Act lawsuit); wage suits Dec 2024-Jan 2025 (effective ~$15/hr vs $16 CA minimum).
- Surge AI: May 2025 misclassification class action.
- Mercor: contractors report surveillance, "treated like cattle" (Moneywise).
- No incumbent publishes retention rates. Workers advised to "diversify platforms."
- **ECOS's wedge: dignity, transparency, and ownership.**

### 2. Serve Genius and Beginner via Progressive Disclosure + Three-Way Router
Progressive disclosure (Nielsen 1995): show the few most-important options first, reveal complexity on demand.

**Three-way confidence router (upgrade from two-way):**
1. confidence >= 0.70 → AUTO_FLOW (deterministic, no human needed)
2. confidence 0.50-0.70 AND non-high-stakes → BEGINNER_QUEUE (AI scaffolding + senior review)
3. confidence < 0.50 OR high-stakes domain → SENIOR_QUEUE (expert tools + quorum)

High-stakes domains (EU AI Act Annex III aligned): healthcare, legal, finance, employment, insurance, credit, biometric, public-service.

**Cognitive accessibility:** WCAG 2.2 (Guidelines 3.1, 3.2, 3.3), COGA 8 objectives — plain language at lower-secondary reading level, predictable layouts, minimal memory load.

**Proven model (Roblox DevEx):**
- 24,500+ creators; median $1,575/yr; top-1,000 avg $820K/yr; $1B+ paid Mar 2024-Mar 2025.
- 33% of creators had never taken a CS class; 44% wouldn't have built without Roblox.
- **ECOS should make a novice's first validated micro-task feel like Duolingo's first lesson.**

### 3. AI Governance: Deterministic Core + Probabilistic Edge (Inviolable Doctrine)
- LLMs are "probabilistic next-token predictors, not arithmetic engines" (arxiv 2603.04663).
- Pattern: the LLM proposes, a deterministic verifier disposes.

**Deterministic core (no LLM ever):** BigInt-microcent ledger, balance math, royalty splits, settlement rules. Undefined condition = execution halts.

**Probabilistic edge (LLM allowed):** task classification, confidence scoring, draft explanations, dispute summarization, anomaly flagging.

**Guardrail stack:** RAG grounding + enforced citations; output schema validation; confidence thresholds + escalation; decoding constraints; SHA-256 audit chain as immutable log.

**Governance standards roadmap (sequenced):**
1. NIST AI RMF — Govern/Map/Measure/Manage (free, flexible, 3-6 months)
2. ISO/IEC 42001 — certifiable AI management system (2-4 months added)
3. EU AI Act — high-risk obligations enforceable Aug 2, 2026; fines up to EUR15M or 3% turnover
4. OWASP Top 10 LLMs + Agentic Applications (2025) — prompt injection #1, excessive agency
5. Singapore Agentic AI Governance Framework (Jan 2026) — cascading failures, attribution gaps

### 4. Money Movement: Closed-Loop First, Partner for Fiat, Architect for Compliance Now
**Phase 0-1 (current):** Pure closed-loop credits. Cannot be transferred to third parties or cashed out internationally. Stays within FinCEN's closed-loop / payment-processor / integral exemptions. Gaming companies operate exactly this way.

**Phase 2 (when validators need real money):** Integrate regulated payout partner (Tipalti as Roblox does, or stablecoin rails). ECOS never holds or transmits fiat — partner is the MSB/licensed entity and runs KYC/AML/Travel Rule.

**Stablecoin rails are now production-grade:**
- Total stablecoin payments: ~$390B annually (McKinsey/Artemis Feb 2026)
- B2B: ~$226B (60%), up 733% YoY
- Bridge (Stripe-owned), BVNK ($30B annualized 2025, 2.3x YoY; clients: Worldpay, Deel, Flywire), Circle Payments Network, Cross River
- US GENIUS Act (2025): regulatory clarity for stablecoins
- ISO 20022: mandatory for cross-border payments Nov 22, 2025
- FATF R.16 June 2025: Travel Rule integrated with ISO 20022

**Architect for compliance now:** Capture ISO 20022-compatible originator/beneficiary fields in audit events from day one. See `lib/iso20022Fields.js`.

### 5. Viral Growth = Ownership-Powered Graduation Loop, Not Speculation
**The loop (Roblox + Braintrust applied):**
```
USE → VERIFY → OWN → RECRUIT
(spend)  (earn)  (royalties forever)  (refer → earn)
```
Users who achieve real economic self-realization recruit and teach the next cohort.

**Ownership retention models:**
- Braintrust: 0% talent fee vs. 20-40% incumbents; ~50% acquisition from referrals; cost "nearly zero"; $3.5M GSV (2020) → $31M run-rate (2021).
- Stocksy: 50-75% royalties vs. ~15% Shutterstock; $24.7M+ to ~1,000 artists.
- Drivers Cooperative: 8-10% more per trip, 15% commission vs. 40% Uber/Lyft.

**Critical — the token trap:** BTRST collapsed ~99.8% from 2021 high ($41-49 → $0.07). ECOS should NOT launch a speculative token. Use reputation, royalties, profit-sharing, cooperative equity.

### 6. Monetize Every Action via Audit + Provenance Design
- SHA-256 audit log converts activity into verifiable, monetizable provenance.
- Proof-of-contribution: who supplied/validated what, with royalty routes attached.
- Jaron Lanier's "data dignity" made operational: each correction is a durable, royalty-bearing asset.
- Compounding mechanisms: validation → reputation → higher pay tiers; patch → micro-royalties; audit chain → compliance-as-a-service product.

---

## Implementation Priorities for V115+

### P11 — Research Integration
| ID | Feature | Priority |
|----|---------|---------|
| P11-01 | Wire ThreeWayRouter into API server (replace two-way gate) | HIGH |
| P11-02 | Graduation ladder API (`GET /api/v1/users/:id/graduation`) | HIGH |
| P11-03 | ISO 20022 fields in all value-moving audit events | HIGH |
| P11-06 | Displaced worker onboarding (paid orientation, first task <60s) | HIGH |
| P11-08 | Golden tasks for validator quality QC | HIGH |
| P11-09 | Sybil resistance in validator onboarding | HIGH |
| P11-04 | NIST AI RMF self-assessment report endpoint | MEDIUM |
| P11-07 | Stablecoin rails stub (Bridge/BVNK adapter) | MEDIUM |
| P11-10 | GraduationEngine + ThreeWayRouter + ISO20022 tests | MEDIUM |

### STR-02 (Unchanged — #1 Business Priority)
3-5 paying design-partner customers. Insurance Claims OR Legal Document Review.
EU AI Act deadline: August 2, 2026. Stack is compliance-ready.
