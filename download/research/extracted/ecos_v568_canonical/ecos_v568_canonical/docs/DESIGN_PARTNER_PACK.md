# ECOS Design Partner Pack
*V142 · May 2026 · Confidential — For Qualified Design Partners Only*

---

## The One-Sentence Pitch

**ECOS is the verifiable work layer for high-stakes AI: every decision is either auto-settled with a cryptographic confidence guarantee or escalated to a vetted human expert — and every decision is recorded in a SHA-256 tamper-evident audit chain you can hand to a regulator.**

---

## The Problem You Have Right Now

If your organisation uses AI to process claims, review contracts, make credit decisions, or assess employment applications — you have a compliance problem that gets expensive on **August 2, 2026**.

That's when EU AI Act Article 12 (tamper-evident logging) and Article 14 (human oversight) become enforceable for high-risk Annex III systems.

**Penalty exposure:** up to €15M or 3% of global annual turnover for non-compliance.

For a €100M-revenue company: €3M exposure for *not having an audit trail*.

ECOS costs a fraction of that — and you're already making AI decisions today.

---

## What ECOS Does

```
Your AI model outputs a decision
         │
         ▼
  ┌─────────────────────────────────┐
  │    ECOS Confidence Gate         │
  │                                 │
  │  ≥ 0.70 confidence              │
  │  → AUTO_FLOW: settled           │  ← fast, cheap, logged
  │                                 │
  │  0.50–0.70 confidence           │
  │  → HITL_QUEUE: human reviews    │  ← validated, logged
  │                                 │
  │  < 0.30 confidence              │
  │  → BLOCK: rejected, flagged     │  ← protected, logged
  └─────────────────────────────────┘
         │
         ▼
  SHA-256 append-only audit chain
  ┌─────────────────────────────────┐
  │ Every decision. Immutable.      │
  │ Tamper-evident. Replayable.     │
  │ Exportable to regulators.       │
  └─────────────────────────────────┘
```

---

## The Three Things Regulators Care About

### Article 12 — Record-Keeping ✅
*"High-risk AI systems must automatically log events enabling post-hoc verification."*

ECOS: SHA-256 chained audit log. Every entry links to the previous. Mathematically impossible to alter without detection. Export in 30 seconds.

**Evidence artifact:** `GET /api/v1/chain/proof` → `{ intact: true, headHash, tailHash }`

### Article 14 — Human Oversight ✅
*"High-risk AI systems must allow human intervention and enable humans to override."*

ECOS: Every borderline decision routes to a vetted human validator. Every human decision is recorded. Every override is audited.

**Evidence artifact:** `GET /api/v1/missions/dashboard` → real-time HITL queue visibility

### Article 26 — Deployer Obligations ✅
*"Deployers must retain logs for ≥6 months and report serious incidents."*

ECOS: Logs retained indefinitely (configurable). Incident webhooks on BLOCK verdicts. Downloadable compliance report.

**Evidence artifact:** `GET /api/v1/audit/operator-report` → PDF/Markdown

---

## Demo Walk-Through (20 minutes)

Run `node scripts/demo-setup.js --vertical insurance` before the call.

### Minute 0–3: Show the dashboard
Navigate to the web dashboard. Show:
- Mix of AUTO_FLOW (green) and HITL_QUEUE (amber) tasks
- Confidence scores on every decision
- Real-time queue depth
- *"This is what your AI decisions look like with ECOS. Every one is tracked."*

### Minute 3–8: Show a HITL decision
Submit a task with borderline confidence live. Show it appear in the HITL queue.
Approve it as a validator. Show the audit entry created.
- *"That's Article 14. Your compliance team can see every human review."*

### Minute 8–14: Show the audit chain
Navigate to `/chain`. Show the hash chain. Click "Verify Integrity" — `intact: true`.
Export the chain proof JSON.
- *"This is Article 12. Your legal team can hand this to a regulator."*

### Minute 14–18: Show the compliance report
Run `GET /api/v1/audit/operator-report?format=html`. Download the PDF.
Walk through Article 12, 14, 26 compliance checks.
- *"COMPLIANT_WITH_WARNINGS means your Stripe isn't configured yet — everything else is ready."*

### Minute 18–20: Pricing & next steps
See pricing table below. Agree on 30-day pilot scope.

---

## Pricing

### Design Partner Tier (First 5 organisations)
*Special terms for organisations helping shape the product.*

| Volume | Price | What's Included |
|--------|-------|-----------------|
| Up to 1,000 tasks/month | €500/month | All features, dedicated validator pool, compliance report, EU AI Act PDF |
| Up to 5,000 tasks/month | €1,500/month | Above + priority HITL routing, custom verticals, integration support |
| Enterprise (unlimited) | Custom | Above + SLA, dedicated instance, custom compliance mapping, on-site onboarding |

**Validator economics:**
- Auto-flow task: €0.50 platform fee, no validator share
- HITL task: validator earns 40% of task fee (cleared for €18–95/hr depending on domain tier)
- Domain experts (insurance, legal): billed at €8–25/task, validator earns €3.20–10/task

### Why Design Partner Terms?
You get:
- Product influence — your workflows shape V143+
- Reduced rate locked in for 12 months
- Direct line to engineering for integration issues
- Your logo on our compliance case studies

We get:
- Real tasks through the confidence calibrator
- Validation that the knowledge-patch royalty loop works at scale
- EU AI Act compliance evidence from live deployment

---

## Technical Integration

### 5-minute quick start
```bash
# 1. Health check
curl https://your-ecos-instance.com/api/v1/health

# 2. Submit a task
curl -X POST https://your-ecos-instance.com/api/v1/task \
  -H "X-Api-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input": "Review claim #CL-001: ...", "clientAccountId": "your-org"}'

# 3. Check compliance report
curl https://your-ecos-instance.com/api/v1/audit/operator-report?format=markdown
```

### SDK (Node.js)
```javascript
const { EcosClient } = require('@ecos/client');
const client = new EcosClient({ baseUrl: 'https://your-ecos-instance.com', apiKey: 'YOUR_KEY' });

const result = await client.submitTask({ input: 'Review claim...', clientAccountId: 'your-org' });
// result.verdict: 'AUTO_FLOW' | 'HITL_QUEUE' | 'BLOCK'
// result.confidence: 0.0–1.0
// result.auditHash: 'sha256-...'
```

### Deployment options
| Option | Setup time | Best for |
|--------|-----------|----------|
| ECOS Cloud (coming soon) | 10 minutes | Fast POC |
| Self-hosted Docker | 30 minutes | Data residency requirements |
| Self-hosted Kubernetes | 2 hours | Enterprise / high-volume |

---

## Competitive Positioning

| | ECOS | Raw LLM API | MTurk / crowdsource |
|--|------|------------|-------------------|
| Tamper-evident audit | ✅ SHA-256 | ❌ | ❌ |
| Human-in-the-loop | ✅ automatic | ❌ | ✅ manual |
| Confidence routing | ✅ automatic | ❌ | ❌ |
| EU AI Act Art. 12 | ✅ built-in | ❌ | ❌ |
| EU AI Act Art. 14 | ✅ built-in | ❌ | ⚠️ partial |
| Quality via reputation | ✅ golden tasks | ❌ | ❌ |
| Self-improving | ✅ royalty loop | ❌ | ❌ |
| Per-task cost | €0.50–25 | ~€0.02 | €2–50 |
| Compliance artifact | ✅ downloadable | ❌ | ❌ |

---

## Supported Verticals (August 2, 2026 Deadline)

| Vertical | EU AI Act Category | ECOS Fit |
|----------|--------------------|----------|
| Insurance claims | Annex III — Private services | ⭐ Primary target |
| Legal document review | Annex III — Administration of justice | ⭐ Primary target |
| Credit scoring | Annex III — Access to financial services | ✅ Strong fit |
| HR / recruitment | Annex III — Employment management | ✅ Strong fit |
| Healthcare triage | Annex III — healthcare (Dec 2027) | 🔜 Next wave |

---

## Global Compliance Coverage

Beyond EU AI Act, ECOS maps to:
- **US:** NIST AI RMF, HIPAA (healthcare), CCPA/CPRA (California), SEC AI guidance
- **Singapore:** MAS FEAT principles
- **UK:** AI White Paper + UK GDPR
- **Brazil:** LGPD + AI Bill
- **Israel:** Privacy Authority + Innovation Authority R&D incentive

Full mapping: `GET /api/v1/compliance/global-map`

---

## FAQ

**Q: What if the audit chain conflicts with GDPR right to erasure (Art. 17)?**
A: The audit chain is a legal record of AI decisions — Art. 17(3)(b) exemption likely applies for records required by law. We recommend legal counsel confirm for your jurisdiction. Chain entries can be pseudonymised.

**Q: What AI model does ECOS use for confidence scoring?**
A: ECOS is model-agnostic. Your existing AI model provides outputs; ECOS scores confidence via calibrated heuristics and routes accordingly. We support OpenAI-compatible APIs, Anthropic, and offline/local inference.

**Q: How do validators get paid?**
A: Via your preferred payment rail — Stripe (card), bank transfer, or ECOS Credits. Validators earn 40% of task fee, paid out weekly.

**Q: Can we run ECOS on-premise for data residency?**
A: Yes. The server is a single Node.js process + Postgres. Docker image available. No data ever leaves your environment.

**Q: What's the minimum viable deployment?**
A: Laptop, Node 18+, no Postgres required for POC (in-memory fallback). Production requires Postgres 14+.

---

## Next Steps

1. **Technical call (30 min):** share credentials, we set up your instance, you submit first real task
2. **30-day pilot:** 500 tasks in your vertical, dedicated validator pool
3. **Compliance report review:** we walk your legal/compliance team through the EU AI Act artifact
4. **Design partner agreement signed:** locked-in rate, product roadmap influence

Contact: Fill out the onboarding form at `/onboarding` or email your ECOS contact.

---

*ECOS V142 · Design Partner Pack · Confidential*
*Sacred files unchanged: fiatLedger.js (MD5: 563e9b1f9e67091a5b6527c0a92568e5), auditLog.js (MD5: e5a5c2c27801d2d03991bc8e5a1df8cb)*
