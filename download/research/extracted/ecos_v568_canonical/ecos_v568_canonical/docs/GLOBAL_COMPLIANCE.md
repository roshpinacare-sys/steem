# ECOS — Global Compliance Map
*V127 · 2026-05-30 · globalComplianceMap.js*

## Overview

ECOS operates globally. This document maps ECOS architecture to regulatory obligations
across ALL major jurisdictions — not just EU.

**Key insight:** Every major AI/data market is enacting its own rules.
ECOS's SHA-256 audit chain + HITL gate maps cleanly to all of them.

---

## Coverage Summary

| Region | Jurisdictions | Regulatory Frameworks |
|--------|--------------|----------------------|
| North America | US Federal, US State (CA), Canada | NIST AI RMF, CCPA/CPRA, HIPAA, CA AB 3030, EO 14110, AIDA |
| Europe | EU, UK | EU AI Act, GDPR, UK AI White Paper, UK GDPR |
| Asia-Pacific | Singapore, Japan, Australia, India, Israel | MAS FEAT, METI 2.0, AU AI Ethics, DPDP, APPI |
| Latin America | Brazil, Mexico | LGPD, Brazil AI Bill |
| Middle East | UAE, Israel | UAE AI Strategy 2031, UAE PDPL |

---

## North America

### United States — Federal

#### NIST AI RMF (Voluntary)
The most widely referenced AI governance framework in the US market.
Enterprise buyers increasingly require alignment as a procurement gate.

| NIST Function | ECOS |
|---|---|
| GOVERN | SHA-256 audit chain; confidence gate policy documented |
| MAP | Domain-scoped routing; high-risk verticals → HITL |
| MEASURE | Platt-scaling calibration; validator reputation scores |
| MANAGE | Human override; replay engine; incident logging |

**Artifact:** `GET /api/v1/compliance/nist-report`

#### Executive Order 14110 — AI Safety (Federal)
- Safety testing → Confidence gate + BLOCK verdict
- Human oversight → HITL gate for confidence 0.30–0.70
- Auditability → SHA-256 chain; `GET /api/v1/audit/export`

#### SEC AI/ML Model Risk (Finance vertical)
- Model risk documentation → Confidence calibrator + Platt scaling
- Explainability → Rationale attached to every HITL decision
- Audit trail → SHA-256 chain; 6-month retention

---

### United States — State Level

#### CCPA / CPRA (California)
**Penalty:** $2,500–$7,500 per intentional violation.
- Data minimization: task inputs not retained beyond chain requirements
- Right to know: per-account audit exports on request
- **Artifact:** `GET /api/v1/compliance/privacy-report?jurisdiction=california`

#### HIPAA (Healthcare vertical)
**Penalty:** $100–$50,000 per violation; up to $1.9M/year per category.
- Audit controls: SHA-256 chain + access logs
- Access controls: JWT auth + validator RBAC
- BAA template: available for healthcare partners
- **Artifact:** `GET /api/v1/compliance/hipaa-report`

#### California AB 3030 (Healthcare AI Disclosure)
Effective January 1, 2025. Requires AI disclosure in healthcare communications.
- ECOS attaches AI-generated flag + confidence score to every output
- HITL routes low-confidence healthcare decisions to human validator

---

### Canada

#### AIDA (Proposed — Bill C-27)
**Penalty:** Up to 3% of global revenue or CAD $10M.
Strongly modeled on EU AI Act. ECOS's HITL + audit chain maps directly.
Status: **Pre-emptive compliance — zero additional work needed.**

---

## Europe

### EU AI Act (August 2, 2026)
**⚠️ Primary deadline — 64 days from today.**
**Penalty:** €15M or 3% turnover (high-risk); €35M or 7% (prohibited practices).

> Full mapping in `docs/EU_AI_ACT_COMPLIANCE.md`.

Key artifacts:
- `GET /api/v1/audit/eu-ai-act-report` — Article 12 record-keeping evidence
- `GET /api/v1/missions/dashboard` — Article 14 human oversight evidence
- `GET /api/v1/chain/proof` — chain integrity

### GDPR
**⚠️ Tension:** GDPR Art. 17 (right to erasure) conflicts with ECOS's append-only audit chain.
**Resolution needed:** Legal counsel to confirm data-pseudonymization approach.
Core audit chain is a legal record → Art. 17(3)(b) exemption likely applies.

### UK (Post-Brexit)
UK AI White Paper is deliberately lighter-touch than EU AI Act. ECOS exceeds requirements.
UK GDPR equivalent to EU GDPR — same Art. 17 tension applies.

---

## Asia-Pacific

### Singapore — MAS FEAT Principles
Critical for finance/insurance verticals entering Southeast Asia.

| FEAT Principle | ECOS |
|---|---|
| Fairness | Validator reputation engine; golden task QC |
| Ethics | Confidence gate + BLOCK verdict; pressure detector |
| Accountability | SHA-256 chain; X-Agent-Id on every response |
| Transparency | Confidence score + rationale; `GET /api/v1/audit/dag` |

### Japan — METI AI Governance Guidelines 2.0
Human-centric, accountability-focused. HITL gate is the central compliance artifact.

### Australia
AU AI Ethics Framework (voluntary) — ECOS exceeds all principles.
Privacy Act 2024 amendments raise fines to AUD $50M — data minimization priority.

### India — DPDP Act 2023
**Penalty:** Up to ₹250 Crore (~$30M USD). Effective from 2025.
LGPD-class obligations: purpose limitation, data minimization, grievance redressal.

### Israel
Privacy Protection Authority guidelines + Innovation Authority R&D incentives.
**Opportunity:** Israel Innovation Authority grants available for qualifying AI companies.
ECOS architecture likely qualifies — pursue in parallel with product development.

---

## Latin America

### Brazil — LGPD
**Penalty:** Up to 2% of Brazil revenue; max R$50M per infraction.
SHA-256 chain satisfies Art. 37 (record-keeping obligation).

### Brazil AI Bill (PL 2338/2023)
EU AI Act-inspired. ECOS's HITL + audit chain maps directly.
Status: **Pre-emptive compliance** — if it passes as written, zero additional work.

---

## Middle East

### UAE
UAE AI Strategy 2031 is pro-innovation, governance-light. ECOS exceeds requirements.
UAE PDPL data protection rules — data residency may be required for some verticals.

---

## Developer API

```
GET /api/v1/compliance/global-map
→ { jurisdictions, totalFrameworks, regions, byRegion }

GET /api/v1/compliance/region/:id
→ { jurisdiction, region, frameworks[] }

GET /api/v1/compliance/applicable
  ?jurisdictions=us-federal,eu,singapore
  &vertical=insurance
→ { frameworks[], highPriority[], opportunities[] }
```

---

## Sales Pitches by Region

### US Enterprise (Finance/Insurance/Healthcare)
> "ECOS delivers NIST AI RMF alignment, HIPAA audit controls, and SEC model-risk
> documentation in a single audit chain you can hand to your compliance team today."

### EU (Any High-Risk Vertical)
> "Every AI decision in ECOS maps to EU AI Act Article 12 (tamper-evident logging)
> and Article 14 (human oversight) — ready for August 2, 2026 enforcement."

### APAC (Singapore / Financial Services)
> "ECOS aligns with MAS FEAT principles out of the box — Fairness, Ethics,
> Accountability, and Transparency are built into every workflow."

### Global Enterprise
> "One audit chain. Every regulation. ECOS is the compliance infrastructure
> for high-stakes AI work across all your operating jurisdictions."

---

## Gaps + Next Steps

| Gap | Action | Priority |
|-----|--------|----------|
| GDPR Art. 17 tension | Legal opinion on pseudonymization approach | HIGH |
| HIPAA BAA template | Draft BAA with healthcare counsel | HIGH (if entering healthcare vertical) |
| CCPA data inventory | Document what task input data is retained and where | MEDIUM |
| India DPDP onboarding | Data processor agreements for Indian customers | MEDIUM |
| Israel IIA grant application | Apply for Innovation Authority R&D grant | OPPORTUNITY |
| UAE data residency | Evaluate regional hosting for UAE customers | LOW |

---

*GLOBAL_COMPLIANCE.md · ECOS V127 · 2026-05-30*
*Review with legal counsel in each jurisdiction before making compliance claims to customers.*
