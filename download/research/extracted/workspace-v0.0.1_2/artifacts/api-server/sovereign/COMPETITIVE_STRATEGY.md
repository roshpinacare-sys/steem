# TFA — מפת-מתחרים → תוכנית-מימוש לסוכנים (v127, ע"י Claude)

> מסמך-כיוון. **לא קוד.** מזקק את מחקר-המתחרים (GPT-5.5) למשימות שאפשר לממש כאן,
> בלי תלויות חיצוניות, בלי רשת, בלי DB. כל פריט מנוסח כך שסוכן יוכל לקחת אותו
> ישירות ל"החסר הבא" שב-MANIFEST. מונחים טכניים באנגלית.

## 1. ההכרעה האסטרטגית (הקשר שמכתיב את כל השאר)
TFA הוא **trust control plane** מעל סוכנים/כלים קיימים — **לא** builder ולא IDE.
אסור להתחרות ב-Replit/Cursor/Lovable/Base44/Claude-Code על UX-בנייה. הניצחון הוא על
**"מי מוכיח הכי טוב"**, לא "מי בונה הכי מהר". הקטגוריה: **Verified Agent Work Infrastructure**.
הדפוס: **קומפוזיציה ולא המצאה-מחדש** — לחקות *מנגנונים* (לא מוצרים) מ-Temporal (durable
execution), OPA (policy-as-code), OpenFGA (relationship auth), Permit.io (approval objects),
Safe (threshold approvals), ולעגן בעתיד החוצה ל-Chainlink/EigenCloud — בלי לאמץ תלות-vendor.

## 2. ארכיטקטורת-היעד: שש שכבות מעל ActionIntent יחיד
כל בקשת-פעולה נכנסת כאובייקט קנוני אחד ועוברת דרך השכבות. זה ה-skeleton שאליו כל
המשימות למטה מתחברות:

```
ActionIntent → [Policy Plane] → [Durable Execution] → [Evidence Plane]
             → [Financial Plane] → [Trust Plane] → [Indexing Plane]
```
- **Policy Plane** — relationship-check (בסגנון OpenFGA: "האם actor X פועל בשם tenant Y על resource Z?")
  + risk/approval policy (בסגנון OPA: "באילו תנאים מותר לבצע?"). פלט: decision חתום.
- **Durable Execution** — מכונת-מצבים שורדת-קריסה (בסגנון Temporal event-history + replay).
- **Evidence Plane** — artifacts + hashes + replay-pack לכל run.
- **Financial Plane** — ledger + escrow + settlement hooks (כבר חזק ב-TFA; ה-ledger דורבל ב-v126).
- **Trust Plane** — ProofBundle + Passport + Verifier SDK (proof-bundle כבר קיים מ-v125).
- **Indexing Plane** — read-model לחיפוש/שאילתה מעל audit/ledger/proof/passport.

### 2.1 ActionIntent — האובייקט הקנוני (היסוד לכל מנוע-האישורים)
כל מתחרה ממלא רק *חלק* מהשדות; ה-moat של TFA הוא לאחד אותם ל-receipt סופי אחד.
שדות מחייבים:
`tenantId, actorId, toolId, resourceRef, riskClass, valueMicrounits (BigInt μ¢),
privacyLevel, approvalPolicyRef, nonce, expiry, provenance, evidencePolicy`.
כללי-ברזל קיימים נשמרים: כסף=BigInt μ¢, קלט לא-תקין=שגיאה, לא-ידוע=fail-closed, סינון לפי tenantId.

## 3. שבע אבני-היסוד → תוכנית-מימוש (פער → פתרון קונקרטי → היקף)
מסודר לפי ערך. סוכן: קח את העליון הפתוח. כל פריט offline, מאחורי interface, עם טסט feature+edge+fail.

1. **ActionRiskClass + ApprovalPolicy (עשיר)** — *הבא בתור.*
   - סכימות קנוניות כ-DATA: `read_only | write_safe | write_destructive | value_moving |
     irreversible | privacy_sensitive | regulated`.
   - מיפוי כל action-type קיים → riskClass. **fail-closed: type לא-ממופה ⇒ הכי-מחמיר (`irreversible`).**
   - ApprovalPolicy לכל class: `auto-approve(+scoped token) | OPA-policy-check | human-approval |
     threshold-approval(+escrow hold) | deny`. (זרימת-ההחלטה: ראה §4.)
   - פלט: `decision_trace` חתום (אותו signer של ה-kernel) שנכנס ל-audit chain.
   - **תת-שלב ראשון מומלץ:** רק ה-taxonomy כ-DATA + מיפוי + guard שמזריק riskClass ל-ActionContext + טסט שכל type ממופה.
2. **ActionIntent canonical object** — type + validator (fail-closed על שדה חסר/לא-תקין) + חיבור ל-orchestrator כך שכל פעולה כספית/אוטונומית נושאת ActionIntent. הבסיס למנוע-האישורים ולכל receipt.
3. **ProofBundle v2** — `canonical JSON + sha256 digests + signer keys + evidence_manifest +
   approval_refs + ledger_refs + policy_refs`. הרחבת ה-proof-bundle הקיים (v125). Verifier offline דטרמיניסטי.
4. **PassportClaim portable + revocation** — אובייקט versioned: `issuer, subject, scope,
   evidence_refs, revocation_status`; `GET /api/passports/:id/status` (issued/valid/revoked);
   local verifier lib. (ממשיך את ה-proof-bundle לכיוון נכס-נייד בר-אימות-צד-שלישי.)
5. **Durable ExecutionWorkflow (in-house, לא Temporal)** — מכונת-מצבים:
   `planned → approved → running → evidence_collected → settled → proved`; persisted run-log
   מעל ה-pool הקיים; replay-from-log; lease/retry. (לא תלות חיצונית — לחקות *סמנטיקה*.)
6. **Escrow/settlement state-machine + signed webhooks** — מצבים: `held | partially_released |
   released | disputed | reversed`; webhooks חתומים-HMAC פר-tenant (הצרכן מאמת כמו passport);
   relayer-adapter מאחורי interface; threshold-approval (סגנון Safe) ל-release גדול.
7. **Eval harness (TFA-native)** — `evals/` עם golden tasks + scorecards:
   `PlanFidelity, ApprovalPrecision, EvidenceCompleteness, ReplayDeterminism, EconomicInvariantScore`.
   מודד לא "האם הסוכן בנה" אלא "האם פעל נכון, מאומת, ובטוח".
8. **(נלווה) Indexer/Trust-Graph read-model** — projection מ-audit/ledger/proof/passport ל-read-model
   נשאל (entities: `Actor, Execution, Approval, Escrow, Passport, Dispute`).

> **הערה על אבן #0 (ledger):** המחקר רשם "ledger persistence חלקי". ב-v126 נסגרה ה-durability
> (pool ⇒ DrizzlePaymentProvider). העומק שנותר: **LedgerEvent append-only store** + `ExecutionID`/`ApprovalID`
> לכל רשומה + **replay-validator ב-startup** (fail-closed אם persistence לא זמין). זה מתחבר לאבן #5.

## 4. זרימת-החלטת-הסיכון (לממש כ-router דטרמיניסטי)
```
ActionIntent → classify risk → relationship allowed? (OpenFGA-style)
  ├─ no  → reject + audit
  └─ yes → by riskClass:
       read_only          → auto-approve + scoped token
       write_safe         → OPA policy check → allow/deny
       write_destructive  → human approval required
       value_moving/irreversible → threshold approval + escrow hold
  → durable execution → collect evidence + compute digests
  → ledger/escrow settle → issue proof bundle + passport claim
  → webhook/API/verifier consumption
```

## 5. דפוס-החיבור: TFA Agent Adapter (לא לבנות מחדש מתחרים)
wrapper שמקבל `ActionIntent`, מריץ policy-check, מנפיק token קצר-חיים scoped לכל run, אוסף
artifacts/logs/patches, ובסוף דוחף `ExecutionReceipt` חתום ל-TFA. יעדי-חיבור: Claude Code,
Cursor Cloud Agent, OpenHands SDK, n8n node, GitHub Action, Replit/Lovable/Base44 (דרך GitHub
sync/webhooks/CI step). העיקרון: **ה-builder נשאר builder; TFA מספק את שכבת ה-proof אחרי build/test/deploy.**

## 6. כללי-רישוי (סיכון ממשי — לשמור על הליבה נקייה)
מותר להישען עמוק רק על **permissive infra**: Temporal, OPA, OpenFGA. את השאר לצרוך דרך
**API/adapter/protocol — לא vendoring של קוד.** סיכונים: n8n (Sustainable Use License),
OpenHands (רכיבי enterprise לא-open), Safe Transaction Service (FSL לפיתוח חדש מ-02/2026),
Aragon (חלקים AGPL), OpenZeppelin Defender (sunset 07/2026 — לאמץ דפוסי Relayer/Monitor בלבד).

## 7. אבטחה ופרטיות (חוצה-כל-השכבות)
fail-closed + minimize-data-exposure. tokens קצרי-חיים ומוגבלי-scope; workers חיצוניים מקבלים
payload מינימלי; artifacts מסומנים `public/hash-only/private`; לשכבות חיצוניות (עתידי) נשלחים
digests בלבד כשאין הכרח ב-raw tenant data. decision-traces ו-approval-objects נכנסים ל-audit
chain כדי לאפשר replay ו-forensics.

## 8. מסחור (כיוון, לא משימת-קוד עכשיו)
המוצר הראשי = **Trust/Proof API**, לא "agent platform". חבילות: `Execute with Proof, Verify
Proof, Approval API, Passport API, Escrow Hooks, Audit Export`. שלוש זוויות GTM: **BYO Agent**
(צוותים שכבר על Cursor/Claude-Code/n8n שחסר להם control-plane), **Platform Trust Infrastructure**
(marketplaces, BPO, fintech/ops — "pay only on verified completion"), **Compliance & Change-Control**.
תמחור היברידי תלת-שכבתי: free verifier-SDK → usage-based על verified actions/proof bundles →
high-assurance על value-moving/escrow/external-anchors. (פיאט אמיתי רק מאחורי adapter מרושה — כלל קיים.)

## 9. מה לא לעשות עכשיו (מלכודות — תואם MANIFEST)
SDK ציבורי לפני ש-ActionIntent קפא · marketplace לפני נזילות · בלוקצ'יין כיסוד (רק anchor-adapter
מאוחר ואופציונלי) · vendoring של קוד מתחרים · "פיצ'ר לכל לקוח" · אמון ל-in-memory בלבד.

---

## עדכון מפת-תחרות 2026 (מבוסס מחקר מעמיק — ע"י Claude)

> **תזה חדה:** TFA = שכבת **הוכחת-הביצוע** (proof-of-execution) הניטרלית, מעל מסילות-תשלום ומתחת ל-frameworks.
> AP2/x402 מוכיחים *כוונה/תשלום*; כמעט אף אחד לא מוכיח *ביצוע* עם receipts ניידים ששורדים rotation — זה השטח של TFA.
> אזהרה: "ניטרליות" נשחקת (x402→Linux Foundation 4/2026, MCP/A2A→Agentic AI Foundation 12/2025). לנצח על **הארטיפקט** (receipt נייד + סיווג-סיכון server-side), לא על ניטרליות לבד.

### מתחרים לפי קטגוריה (מה / moat / הפער ש-TFA מנצל)
- **ארנקי-סוכנים — MetaMask Agent Wallet** (Guard/Beast, סימולציה→Blockaid→MEV, כיסוי $10k, ERC-7710/7715): EVM-only, single-vendor שופט-עצמו. *פער:* לא מוכיח דבר נייד על file.delete/db.migration; receipt תקף רק בתוכו.
- **תשלומים — Coinbase x402 / Google AP2 (Mandates=W3C VC) / Visa TAP ("cannot be replayed") / Stripe ACP+SPT / Mastercard Agent Pay:** מוכיחים הרשאת-תשלום, לא ביצוע פעולה כללית. **TFA צורך אותם** (escrow/ledger).
- **זהות — Okta/Auth0 (XAA, OBO RFC 8693, FGA, CIBA) / SPIFFE / ERC-8004** (mainnet 1/2026: Identity/Reputation/Validation): מנהלים *מי-מורשה*, לא proof שהפעולה בוצעה. **TFA צורך טוקנים, ויכול להיות Validation-provider**.
- **מדיניות — OPA/Cedar/OpenFGA/Permit:** עונים "מורשה?"; לא מסווגים **סיכון**, לא execution, לא receipts. TFA מעליהם.
- **Durable — Temporal/Inngest/Restate/AWS Durable Functions:** מגדירים רף; הבידול = trust-gate סביבם.
- **Frameworks/guardrails — LangGraph/CrewAI/OpenAI AgentKit(נסגר 11/2026)/NeMo/Invariant(→Snyk):** טקסט בתוך runtime; לא receipt נייד. "guardrails מחליטים — TFA מוכיח וגוזר". חובה MCP-native.
- **Compliance — Vanta/Drata:** פוסטורה ארגונית, לא per-action. receipt מזין אותם כראיה.
- **Verifiable compute — EigenCloud/Chainlink/zkML:** כבד וchain-anchored; receipts קלים (Ed25519 + transparency-log) הם האמצע.
- **Observability — LangSmith/Arize/Datadog:** טלמטריה mutable; receipt = הבן-דוד החתום. לפלוט OTel **וגם** receipts.

### יתרונות Tier-1 (כל אחד מול פער; ישים TS zero-dep)
1. ExecutionReceipt נייד ששורד rotation — Ed25519+KID (✅ KeyRing v202). 2. **Transparency-log/Merkle anchoring** (Sigstore/Rekor) → verify-after-revocation. 3. אימות-offline ע"י צד-שלישי. 4. **סיווג-סיכון server-side** (file.delete/db.migration/infra.apply) — ASI01/ASI02. 5. מדיניות auto/human/threshold+escrow/deny + ConfidenceGate. 6. capability tokens חתומים (Biscuit/UCAN-style attenuation). 7. חתימות time-bound לא-replayable (רף Visa TAP). 8. simulation/dry-run לפני פעולה (+diff ל-receipt). 9. receipt תואם W3C VC 2.0/AP2. 10. **kill-switch** (✅ v215/v224) · delegation attenuation (פער ש-Okta מסמנת) · ledger μ¢+escrow+threshold.

### צ'קליסט פערים שוברי-שימוש (OWASP Agentic Top-10 / NIST AI RMF)
לפני פיילוט: risk server-side · הגנת prompt-injection (ASI01) · tool-misuse/arg-validation (ASI02) · attenuation בהאצלה (ASI03) · **replay protection** · **idempotency** · key rotation/history · **tenant isolation** קשיח · signed webhooks · SBOM (zero-dep=יתרון) · threat-model כתוב. תפעול: healthz/readyz · graceful shutdown · migrations · **backup/RTO-RPO** · OTel · rate-limit · contract-tests + **OpenAPI truthfulness** · license · determinism. ממשל: liability/dispute (escrow) · regulatory (non-custodial) · **kill-switch** (✅).

### תוכנית-שלבים
- **Stage 0:** לסגור צ'קליסט production (1–20). zero-dep=יתרון supply-chain (SBOM+חתימה). MCP 5-tools + OTel.
- **Stage 1 (wedge):** proof-of-execution לפעולות-קוד מסוכנות. קונה ראשון = devtools/agentic-coding. נרטיב: תקרית Replit (מחיקת DB ב-prod, 7/2025). מוביל ב-receipts ניידים ששורדים rotation.
- **Stage 2 (interop):** receipts תואמי AP2/VC-2.0; Validation-provider ל-ERC-8004; לצרוך Okta/SPIFFE/x402/Stripe; ראיות ל-Vanta.
- **Stage 3 (moat):** transparency-log anchoring → post-quantum hybrid (ML-DSA+Ed25519, CNSA 2.0 2030) + ZK envelopes.

---

## פריצת AP2 + תמונת-שוק רחבה (v250, ע"י Claude)

**הפריצה:** TFA כעת **משלים את שרשרת ההרשאה של Google AP2**. AP2 (Google + Visa/Mastercard/Amex/PayPal/Coinbase) מוכיח *הרשאה* דרך Mandates (Intent/Cart/Payment כ-W3C VC) — אך **לא** מוכיח שהפעולה בוצעה לפי מדיניות. `MandateLinkage` החתום של TFA כורך ExecutionReceipt לשרשרת ה-AP2 → הוכחה end-to-end חוצת-vendor: *user-authorized (AP2) → policy-gated-and-executed (TFA)*. **אף מתחרה לא מספק את חצי-הביצוע הזה.** זה הופך את TFA לאזרח-תקן במקום אי קנייני.

**תמונת-שוק (היכן TFA מנצח — לא רק במילים):**
- מול **ארנקי-סוכנים** (MetaMask Agent Wallet): הם vendor chain-bound; TFA נייטרלי, חוצה-chain, ומוכיח כל פעולה (לא רק tx).
- מול **תשלומים** (x402/AP2/Visa TAP/Stripe ACP): מוכיחים תשלום/הרשאה; TFA צורך אותם ומוסיף את **הוכחת-הביצוע** (AP2-linkage).
- מול **זהות** (Okta/Auth0/SPIFFE/ERC-8004): מנהלים *מי-מורשה*; TFA צורך טוקנים ומוכיח *מה-בוצע*. יכול להיות Validation-provider ב-ERC-8004.
- מול **מדיניות** (OPA/Cedar/OpenFGA): PDP בלבד; TFA = סיווג-סיכון server-side + execution + receipts מעליהם.
- מול **durable** (Temporal): מנוע workflow; TFA = trust-gate חתום סביבו.
- מול **frameworks/guardrails** (LangGraph/AgentKit/NeMo/Invariant): טקסט בתוך runtime; TFA = proof נייד חוצה-vendor (MCP-native).
- מול **compliance/observability** (Vanta/Drata/LangSmith): פוסטורה/טלמטריה mutable; TFA = receipt חתום per-action בר-אימות-offline (verify-after-revocation דרך transparency-log).

**שלושת ה-wedges (סדר ביצוע):** #1 Trust Gate לסוכני-קוד (Claude Code/Cursor/OpenHands) · #2 CI/CD + GitHub Action · #3 אוטומציה ארגונית (n8n/Zapier) + marketplace. **הצעד הקרוב:** SDK/CLI publish + GitHub Action — להפוך את ה-core הבשל למאומץ.
