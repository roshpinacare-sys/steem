# ECOS — EU AI Act Compliance Mapping
*V107 · 2026-05-29 · DEADLINE: August 2, 2026*

## Summary

ECOS's core architecture maps almost exactly onto EU AI Act obligations for high-risk AI systems.
This document is the compliance selling artifact — exportable to customers and regulators.

---

## Article 14 — Human Oversight Requirements → ECOS HITL Gate

**Legal obligation:** High-risk AI systems must allow human oversight, enable human intervention,
and ensure humans can override AI decisions.

| Article 14 Requirement | ECOS Implementation |
|---|---|
| Human can override AI decisions | HITL_QUEUE: every task with confidence 0.50–0.70 escalates to human validator |
| Human can stop system operation | BLOCK verdict: confidence <0.30 → task rejected, not escalated |
| Humans understand system limitations | Confidence score + rationale attached to every decision |
| Appropriate human oversight measures | voidInterlock middleware prevents concurrent double-processing |

**Export artifact:** `GET /api/v1/chain/proof` + `GET /api/v1/missions/dashboard` → human oversight evidence.

---

## Article 12 — Record-Keeping Requirements → ECOS Audit Chain

**Legal obligation:** High-risk AI systems must automatically log events enabling post-hoc verification.
Deployers must retain logs ≥6 months (Article 26).

| Article 12 Requirement | ECOS Implementation |
|---|---|
| Tamper-evident logging | SHA-256 chain — `lib/auditLog.js` (Sacred File) |
| Each AI decision recorded | Every task → audit log entry with hash, timestamp, confidence, verdict |
| Traceability of inputs/outputs | `lib/inferenceProvenance.js` — cryptographic binding of AI outputs to audit entries |
| Log integrity verification | `GET /api/v1/chain/proof` → headHash/tailHash/intact status |
| Log export for regulators | `GET /api/v1/audit/export` → full chain export |
| Replay for post-hoc verification | `GET /api/v1/audit/replay` → deterministic state reconstruction |

**Export artifact:** `GET /api/v1/audit/dag` → visual audit trail for regulators.

---

## Article 26 — Deployer Obligations → ECOS Customer Compliance

**Legal obligation:** Deployers of high-risk AI must implement technical and organizational measures,
retain logs ≥6 months, report serious incidents.

| Article 26 Requirement | ECOS Customer Feature |
|---|---|
| Log retention ≥6 months | Postgres-backed audit_log table — retained indefinitely |
| Monitor system operation | `GET /api/v1/missions/dashboard` — real-time visibility |
| Report serious incidents | Webhook notifications on BLOCK verdicts |
| Ensure human oversight | HITL queue with validator assignment tracking |

---

## Penalty Exposure (Why Customers Pay)

| Violation | Maximum Fine |
|---|---|
| Prohibited practices (Art. 5) | €35M or 7% of global annual turnover |
| High-risk non-compliance (Art. 12/14) | €15M or 3% of global annual turnover |
| Information obligations | €7.5M or 1% of turnover |

**Sales angle:** A company with €100M revenue faces €3M penalty for Art. 12/14 non-compliance.
ECOS subscription is trivially cheap by comparison.

---

## High-Risk Annex III Categories Relevant to ECOS Beachheads

| Category | ECOS Vertical | Enforcement Date |
|---|---|---|
| Biometric identification | — | Feb 2, 2025 |
| Critical infrastructure | — | Aug 2, 2026 |
| **Employment/workforce management** | Validator routing decisions | Aug 2, 2026 |
| **Access to private services** | Insurance claims processing | Aug 2, 2026 |
| **Administration of justice** | Legal document review | Aug 2, 2026 |
| Law enforcement | — | Aug 2, 2026 |
| Some high-risk categories | — | Dec 2, 2027 (AI omnibus extension) |

---

## How to Present This to Customers

### One-sentence compliance pitch:
> "Every AI decision in ECOS is either automatically settled with a cryptographic confidence guarantee or escalated to a vetted human expert — and every decision is recorded in a SHA-256 tamper-evident audit chain you can hand to a regulator on August 2, 2026."

### What to show in demo:
1. Submit a task → show confidence score + verdict
2. Show HITL escalation → validator assignment
3. Export audit chain → `GET /api/v1/audit/dag`
4. Show replay → `GET /api/v1/audit/replay`
5. Map to Article 12/14 obligations on screen

---

*EU_AI_ACT_COMPLIANCE.md · ECOS V107 · 2026-05-29*
*Review with legal counsel before making compliance claims to customers.*

---
## See Also
For coverage beyond EU: `docs/GLOBAL_COMPLIANCE.md` — V127 global compliance map (US, APAC, LATAM, Israel, UAE)
