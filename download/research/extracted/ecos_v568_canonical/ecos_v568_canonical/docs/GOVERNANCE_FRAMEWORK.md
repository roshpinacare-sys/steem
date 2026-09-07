# ECOS Governance Framework — V114
*V114 Research Integration, May 29, 2026*

## Overview

ECOS maps its existing technical primitives to recognized governance standards to unlock
enterprise buyers and regulated markets. Sequencing ordered by urgency and implementation cost.

---

## Standard 1: NIST AI RMF (Start Here)

**Timeline:** 3-6 months | **Cost:** Free | **Requirement:** Voluntary (US)

| NIST Function | ECOS Implementation |
|---|---|
| GOVERN | SHA-256 audit chain as governance artifact; confidence gate policy documented |
| MAP | Task routing documented by risk level; high-risk domains flagged for HITL |
| MEASURE | Platt-scaling calibration; validator reputation scores; auto-settle rate tracking |
| MANAGE | Human override at any confidence level; rollback via replay engine; incident logging |

**Positioning:** "ECOS is built to NIST AI RMF from the ground up, not retrofitted."

---

## Standard 2: ISO/IEC 42001 (Certifiable AI Management System)

**Timeline:** 2-4 months added | **Requirement:** Enterprise buyers demand it

ISO 42001 requires a documented AI management system with:
- Risk assessment process -> confidence gate + HITL gate
- Human oversight mechanism -> HITL Gate, validator quorum
- Audit/logging -> SHA-256 audit chain, immutable append-only log
- Incident management -> replay engine, snapshot/restore

---

## Standard 3: EU AI Act High-Risk Obligations

**Deadline: August 2, 2026** (~64 days from May 29, 2026)
**Fine exposure:** Up to EUR15M or 3% of global annual turnover

### Annex III High-Risk Systems (relevant to ECOS)
- Employment and worker management (validator routing)
- Credit scoring (ECOS credit allocation)
- Legal (target vertical: legal doc review)
- Insurance (target vertical: insurance claims)

### Article 14 — Human Oversight (ECOS's primary selling point)
ECOS compliance artifacts:
- Confidence gate: every AI output is auto-settled (>=0.70) or human-reviewed
- HITL Gate: documented queue, approval workflow, quorum option
- `GET /api/v1/audit/eu-ai-act-report` — compliance report endpoint (V113)
- `GET /api/v1/audit/eu-ai-act-report?format=pdf` — downloadable artifact (V114)

### Article 12 — Record-Keeping
ECOS compliance: SHA-256 chained audit log, immutable, append-only, replayable.

---

## Standard 4: OWASP Top 10 for LLMs + Agentic Applications

### Top threats relevant to ECOS:
1. **LLM01 - Prompt Injection:** Mitigated by system-prompt constraints, RAG grounding with enforced citations, output schema validation.
2. **LLM08 - Excessive Agency:** Mitigated by minimum-permission tool grants; human approval required for all value-moving operations; authorization runs in external systems, never delegated to LLM.
3. **Agentic - Cascading Failures:** Bounded execution (halt on undefined conditions), replay engine for recovery.
4. **Agentic - Attribution Gaps:** SHA-256 audit chain with originator tracking.

---

## Standard 5: ISO 20022 + FATF Travel Rule

**Requirement:** Mandatory for cross-border payments as of Nov 22, 2025

ECOS captures ISO 20022-compatible fields in audit events from day one via `lib/iso20022Fields.js`.

### Fields captured in every value-moving audit event:
- originator: accountId, displayName, jurisdiction, entityType
- beneficiary: accountId, displayName, jurisdiction
- amount: micro (BigInt as string), currency, usdEquivalent
- purposeCode: VALI | ROYL | GRNT | RFND | TASK | PLTF
- compliance: closedLoop, travelRuleRequired, fatfR16Compliant

---

## Positioning Statement

> "ECOS is the first human-AI work platform architected for the post-August-2026 compliance
> landscape: EU AI Act Article 14 human oversight is our product, Article 12 audit logging
> is our audit chain, and NIST AI RMF governance is our operational doctrine."
