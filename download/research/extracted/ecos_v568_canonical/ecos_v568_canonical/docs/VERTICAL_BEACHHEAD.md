# ECOS — Vertical Beachhead Playbook
*נגזר מ-Research_Report.md · V107 · 2026-05-29*

## הבחירה: Insurance Claims OR Legal Document Review

בחר לפי מי מהם ייתן לך 3-5 design partners מהר יותר.

---

## למה דווקא שני האלה

| קריטריון | Insurance Claims | Legal Review |
|---|---|---|
| נפח tasks | גבוה מאוד — אלפי claims ביום | גבוה — מאות חוזים ביום |
| עלות שגיאה | גבוהה — payout שגוי, regulatory fine | גבוהה — liability, bar sanctions |
| דרישת audit | חוקית — state insurance regs | חוקית + bar ethics rules |
| WTP מוכח | כן — EvenUp $2B, 10K cases/week | כן — Harvey $195M ARR, $1,200/seat |
| EU AI Act fit | Annex III high-risk system | Annex III high-risk system |
| HITL fit | Perfect — borderline claims לאדם | Perfect — contract ambiguity לאדם |

---

## Go-to-Market Sequence (מבוסס Surge/Polymarket/Chainlink playbook)

### Day 0-30: Productionize + Beachhead Selection
- [ ] החלף mock Stripe → live Stripe (`scripts/stripe-live.js`)
- [ ] בחר vertical אחד (לא שניים)
- [ ] בנה hosted demo ממוקד ב-audit chain export
- [ ] 10 customer interviews — אם לא יכול לנסח "X כואב ל-Y כי Z" → שנה vertical

### Day 30-90: Concierge Design Partners
- [ ] 3-5 paying customers (לא POC, לא pilot ללא תשלום — כרטיס אשראי)
- [ ] גייס validator pool ידנית ובעדינות: ≤20 validators, vetted, domain experts
- [ ] שלם above-threshold: generalists ≥$18-25/hr, domain experts ≥$50-95/hr
- [ ] Instrument everything — auto-settle rate, HITL cost/task, validator churn

**Benchmark:** אם validator churn >20%/month → העלה שכר לפני שמרחיב.

### Day 90-180: Prove the Loop
- [ ] הראה: knowledge patches → auto-settle rate עולה → HITL cost/task יורד
- [ ] Package audit chain כ-EU AI Act Article 12 compliance artifact
- [ ] Package HITL gate כ-EU AI Act Article 14 compliance artifact
- [ ] **DEADLINE: August 2, 2026** — EU AI Act high-risk obligations נכנסות לתוקף

### Day 180-365: Scale Supply Carefully
- [ ] הרחב validators רק כש-paid demand גדל (לא לפני)
- [ ] Fiat/stablecoin revenue-share — רק לאחר proof of loop
- [ ] Token — **רק** אחרי recurring fiat revenue + legal structuring

---

## Validator Economics — Retention Math

| Tier | Minimum Take-Home | ECOS Task Pricing Implication |
|---|---|---|
| Generalist | $18-25/hr | task של $10 + 40% share → task חייב לקחת ≤13 min |
| Domain Expert | $50-95/hr | task של $25 + 40% share → task חייב לקחת ≤6 min |
| (MTurk baseline) | $2/hr median | ❌ Quality collapse — לא ללכת לשם |

**Rule:** Price or batch tasks so 40% of fee clears the tier's hourly threshold.

### Anti-patterns להימנע (Scale AI/Remotasks)
- ❌ Payment withholding
- ❌ Opaque deactivation
- ❌ Sub-threshold wages in Global South
- ❌ No Sybil resistance in onboarding

### Must-haves מday one
- ✅ Transparent, timely payment
- ✅ Golden tasks for quality QC
- ✅ Reputation engine for routing
- ✅ Sybil resistance in validator onboarding

---

## Positioning — מה לומר, מה לא לומר

### ✅ Lead with:
> "ECOS is the verifiable work layer for high-stakes AI: every AI decision is either auto-settled with a confidence guarantee or escalated to a vetted human expert, and every decision is recorded in a tamper-evident audit chain you can hand to a regulator."

### ✅ Sell as:
- EU AI Act Article 12/14 compliance infrastructure
- Auditable AI for insurance claims / legal review
- Human-in-the-loop verification with SHA-256 tamper-evident logs

### ❌ Never lead with:
- "Decentralized AI"
- "AI×crypto protocol"
- "Earn tokens for AI work"
- "DePIN for intelligence"

**Why:** That bucket (SingularityNET, Fetch, Bittensor, Ocean) = speculation > substance = stalled adoption.

---

## Regulatory Landmines — Calendar

| Date | Event | ECOS Action |
|---|---|---|
| **Aug 2, 2026** | EU AI Act Art. 12/14 → high-risk enforcement | Must be in production with audit chain |
| Dec 2, 2027 | Some high-risk categories extended | Secondary deadline |
| NOW | US SEC friendlier posture (post-Atkins) | Don't launch token yet — posture can reverse |
| NOW | MiCA (EU) — CASP licensing + utility token rules | Defer token |

**Penalty exposure:** €15M or 3% turnover for high-risk non-compliance. €35M or 7% for prohibited practices.

---

## Defensible Moats (in order of durability)

1. **Self-improving knowledge loop** — corrections → patches → higher auto-settle rate. Compounding data asset.
2. **Audit chain as compliance artifact** — SHA-256 logs mapped to EU AI Act Articles 12+14.
3. **Vetted validator reputation network** — domain specialization like Surge/Mercor.
4. **Switching costs** — customer's compliance record lives in ECOS. Leaving = losing audit trail.

---

*VERTICAL_BEACHHEAD.md · ECOS V107 · 2026-05-29*
