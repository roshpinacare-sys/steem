# TFA — MANIFEST קנוני (v434)
> מקור-האמת. סוכן: קרא → הרץ את מנוע-האמת → קח את המשימה הראשונה הפתוחה.

## מצב נוכחי (v434 — LAW 7: economic-fairness invariant — a routing fee can never exceed the spread; by Claude)
**מספרי אמת (בדיקת-מסירה עצמית): system-invariants.test.ts: 14/0; full --full audit: 473 pass / 0 cannotRun / 0 realFail. +4 טסטים (לקובץ קיים), אפס שינוי-קוד-ריצה.**
*חדש: LAW 7 ב-`tests/system/system-invariants.test.ts` — נועל את הוגנות מודל-ההכנסה הכלכלי כחוק-פיזיקה. מנוע ה-cost-arbitrage (שכבר נבנה) ממליץ על הספק הזול ביותר וגובה routing fee ≤ spread (הפער לספק השני-הזול-ביותר). זה לגיטימי רק אם הקורא תמיד משלם ≤ מחיר-השוק-הבא-בתור — מה שמתקיים אם-ורק-אם ה-fee חסום ע"י ה-spread. v434 מוכיח זאת מול הפונקציות האמיתיות (selectCheapestVendor, routingFeeFromSpread): (a) הזול-ביותר מנצח וה-spread הוא הפער ל-runner-up; (b) על-פני כל שבר של ה-spread, fee ≤ spread ו-winnerCost+fee ≤ runnerUpCost (הקורא משלם ≤ שוק); (c) הפונקציה fail-closed על שבר לא-תקין (מכנה 0, שבר > 1, מונה שלילי → throw); (d) ספק-בודד → spread אפס → fee מקסימלי אפס. שינוי עתידי שיאפשר fee > spread — גביית-יתר שקטה — ייתפס כאן. החוקים כעת: MONEY, TENANT, REPLAY, AUDIT, SPEC↔CODE, PROD-IDENTITY, ECONOMICS.*

### ✅ נבנה ב-v434 (Claude — LAW 7: economic-fairness invariant)
- **`tests/system/system-invariants.test.ts`:** +4 טסטים ל-LAW 7 (economics), מאומתים מול `lib/marketplace/cost-arbitrage.ts` האמיתי. fee ≤ spread על-פני כל שבר; caller משלם ≤ runner-up; fail-closed על שברים לא-תקינים; ספק-בודד → fee אפס. Result: 14 pass / 0 fail (10→14).
- **אפס שינוי קוד-ריצה.** ה-fee-cap כבר היה במימוש (`routingFeeFromSpread` floor-division, numerator ≤ denominator); v434 נועל אותו כ-invariant קבוע. baseline 473 → 473 (טסטים נוספו לקובץ קיים; המנוע סופר קבצים). realFail = 0.

### ✅ נבנה ב-v430–v433 (Claude — efficiency micro-opts — מקופל)
- **v433** `policy-simulator.ts`: ביטול הרצה-כפולה של policy.evaluate (guardDecision נגזר מהלולאה הקיימת). **v432** scorecard single-pass aggregation. **v431** witness-liveness single-pass. **v430** compareScenarios single-pass partition. סמנטיקה זהה; טסטים ייעודיים לכל אחד.

### ✅ נבנה ב-v432 (Claude — single-pass scorecard aggregation in runAllGoldenTasks())
- **שיפור יעילות** ב-`lib/eval/golden-tasks.ts`: `runAllGoldenTasks()` עבר מ-M=6 קריאות `.reduce()` נפרדות (O(tasks × names)) ללולאה אחת שצוברת את כל הסכומים במקביל — O(tasks).
- **הגנה נוספת:** גארד `tasks.length === 0` מחזיר mean=0 (אין חלוקה באפס).
- **3 טסטים חדשים** ב-`tests/eval/eval-harness.test.ts` (אזור "efficiency/single-pass-scorecard-aggregation").

### ✅ נבנה ב-v431 (Claude — single-pass status+stale accumulation in checkWitnessLiveness)
- **שיפור יעילות** ב-`lib/transparency-log/witness-liveness.ts`: `checkWitnessLiveness` עבר מ-`.map()` ואז `.filter().map()` (3 מעברים) ללולאה יחידה שבונה status ומצרפת ל-staleWitnessIds בו-זמנית — מעבר אחד. אותה סמנטיקה בדיוק (סדר, חברות).
- **3 טסטים חדשים** ב-`tests/transparency-log/witness-liveness.test.ts`: בריכה מעורבת גדולה, סדר sorted-dedup, ו-all-live edge-case.

### ✅ נבנה ב-v430 (Claude — single-pass allow/deny partition in compareScenarios)
- **שיפור יעילות** ב-`lib/risk/policy-simulator.ts`: `compareScenarios` עבר מ-`filter+map` ×2 (4 מעברים על `scenarios`) לחלוקה חד-מעברית לשני buckets (2 מעברים). בנוסף, `denyingPolicies` עבר מ-`filter+map` על `policyDecisions` ללולאה ישירה.
- **3 טסטים חדשים** ב-`tests/risk/policy-simulator.test.ts` (אזור "efficiency/single-pass-partition"): סדר-הכנסה, שמות-מדיניות, ו-regression all-deny.

### החסר הבא (לפי סדר ערך — grep + drift-check לפני מימוש)
1. **PQC stage-2b — real provider install** — חסום zero-dep.
2. **SDK npm publish** — חסום-רשת.
3. ✅ **Redacted-proof-bundle HTTP route** — הושלם ב-v427.

### חוב ופערים ידועים (v433)
- **PQC=sim מסומן, עם readyz visibility מתועדת ב-SECURITY.md** (חסום zero-dep) · **SDK לא פורסם** (חסום-רשת).
- **Selective disclosure §2.B: count-proof HTTP route (v425)** ✅ · **predicate-proof HTTP route (v426)** ✅ · **redacted-proof-bundle HTTP route (v427)** ✅.
- **stubs דקים:** AUDIT_REPORT.md, TESTING.md — TESTING נדרש ע"י launch-pack (נשמר).

## מפת-הדרכים — עידן ההפעלה (הקשר; הסדר המחייב הוא "החסר הבא" למעלה)

### שלב J — הפעלה אמיתית (1-5)
1. ✅ **Persist-everything flag:** מצב `TFA_PERSIST=pg` שמרכיב את כל ה-pg-stores כברירת-מחדל (audit/ledger/escrow/track-record/catalog/personality) ומסרב לעלות אם pool חסר (fail-closed). טסט-קונפיגורציה. (`tests/release/persist-flag*.test.ts`)
2. ✅ **Migration bundle:** סקריפט אחד `scripts/migrate.mjs` שמריץ את כל ה-CREATE TABLE הקיימים בסדר, idempotent, עם דוח. (`tests/migrate/migrate.test.ts`)
3. ✅ **Health & readiness:** GET /healthz (liveness) + /readyz (DB reachable, solvency אחרון ירוק, chain verified) — מה ש-load-balancer צריך. (`tests/http/health-shutdown.test.ts`)
4. ✅ **Graceful shutdown:** SIGTERM → סיום בקשות פתוחות, סגירת pool, exit 0. טסט. (`tests/http/health-shutdown.test.ts`)
5. ✅ **Ops runbook:** docs/RUNBOOK.md — הפעלה, גיבוי, שחזור, סיבוב-מפתחות, תקלות נפוצות.

### שלב K — צמיחת אמון (6-10)
6. ✅ **Webhooks (zero-dep):** רישום URL פר-tenant לאירועים (escrow.released, dispute.opened, passport.issued) עם חתימת HMAC על ה-payload + retry. הצרכן מאמת כמו passport. (`tests/escrow/webhook*.test.ts`)
7. ✅ **Trust API ציבורי:** GET /api/track-record/:id/proof — חבילת-הוכחה (הרקורד + הדרכונים התומכים) שצד-שלישי מאמת offline. הרקורד הופך נייד. (`tests/track-record/proof-bundle*.test.ts`)
8. ✅ **Cross-tenant introduction:** מנגנון שבו tenant א' חושף רקורד (proof) ל-tenant ב' לצורך עסקה — בלי לחשוף את השרשרת המלאה. ראשית האמון הבין-ארגוני. (`tests/introduction/cross-tenant-introduction.test.ts`)
9. ✅ **SDK npm-ready:** sdk/passport-client + escrow-client כחבילות publishable (package.json exports, types, README) — בלי לפרסם בפועל. (`sdk/*/package.json`)
10. ✅ **Analytics ל-tenant:** GET /api/insights — settled/volume/fees/trust-trend בחודש האחרון, מחושב מהשרשרת (read-model). (`tests/indexer/insights.test.ts`)

### שלב L — הקשחה (11-15)
11. ✅ **Key rotation:** סיבוב מפתח-חתימה עם תקופת-חפיפה (שני מפתחות תקפים) + עדכון verifier לתמוך ב-kid. (`tests/rbac/require-scope.test.ts`)
12. ✅ **Audit chain anchoring (adapter):** עיגון hash-יומי לקובץ/עוגן-חיצוני מאחורי interface (בלי בלוקצ'יין כיסוד — לפי הכללים). (`lib/transparency-log/`, `tests/transparency-log/`)
13. ✅ **Property-based ledger tests:** מחולל פעולות אקראיות (mint/transfer/escrow) שמאמת אינווריאנטים (solvency, sum-zero) על אלפי צעדים. (`tests/ledger/property-based-ledger.test.ts`)
14. ✅ **Load smoke:** סקריפט שמריץ 1,000 פעולות מקביליות מול השרת ומדווח p95 + שגיאות. סף עובר/נכשל. (`tests/http/load-smoke.test.ts`)
15. ✅ **Threat-model refresh:** עדכון SECURITY.md מול הפיצ'רים החדשים (webhooks, rotation, cross-tenant) + טבלת mitigations. (`tests/security/threat-mitigations.test.ts`)

### לקחים לסוכנים (שגיאות חוזרות)
- שורות-DB: `type X = {...}` ולא `interface` (לא עומד ב-Row constraint).
- import בתוך src/**: העומק הוא `../../lib/` (גם ב-inline import() types ו-`../../scripts/`).
- אסור parameter properties (`constructor(private x)`) — Node strip-only; שדות מפורשים.
- **MANIFEST: החליפו את בלוק "מצב נוכחי" — אל תוסיפו עוד אחד. חתמו בשם הסוכן שלכם.**
- **MANIFEST "מצב נוכחי" מחזיק עד 2 בלוקי "✅ נבנה ב-vNNN" (הנוכחי + הקודם). הישן-משניהם זז ל-"ארכיון" כשורה מכווצת — לא נשאר במקומו. (v369 תיקן הצטברות של ~30 בלוקים שדלגו על הכלל הזה.)**
- עץ-יחיד באריזה; בדקו `find . -name sovereign` = 1.

## איך מריצים (אפס-תלות)
```
node scripts/ecos-audit.mjs            # impact
node scripts/ecos-audit.mjs --full     # הכל
node scripts/ecos-audit.mjs --insight  # flaky / איטיים
node scripts/gen-contract-tests.mjs lib/api-spec/openapi.yaml tests/contract
```

## מה אסור לשנות / לשבור
- אסור ירוק-כוזב: exit 0 בלי שטסטים באמת רצו = לא pass.
- כסף אך ורק דרך guard chokepoint יחיד. כל פעולה אוטונומית/כספית → audit.
- בידוד tenant: כל שאילתה מסננת לפי tenantId. אל תדלוף בין דיירים.
- אל תוסיף תלות חיצונית בתשלום — תמיד מאחורי adapter עם in-house כברירת-מחדל.
- אל תמחק את scripts/ecos-audit.mjs או tests/_harness.mjs (שכבת-האמת).
- אל תגע בטסטי-חוזה ידנית — הם auto-generated.

## מה נחשב "Done" למשימה
(1) הקוד עובד typecheck. (2) יש טסט שבאמת רץ (Passed:N/Failed:0). (3) `node scripts/ecos-audit.mjs` — אין realFail חדש. (4) תיעוד מעודכן.

## מבנה lib/ (נכון ל-v90)
```
lib/
  agent-identity/      types.ts, identity.ts, delegation.ts, index.ts  ← חדש v18
  auth/                jwt.ts, password.ts, totp.ts, crypto-provider.ts, index.ts
  db/                  types.ts, in-memory-driver.ts, index.ts
  events/              types.ts, outbox.ts, index.ts
  jobs/                types.ts, queue.ts, index.ts
  ledger/              types.ts, in-memory-ledger.ts, pg-ledger.ts,
                       drizzle-payment-provider.ts, index.ts
                       pg-ledger.ts ← חדש v19 (PgLedgerStore — PostgreSQL-backed PaymentProvider)
                       drizzle-payment-provider.ts ← חדש v35 (DrizzlePaymentProvider — production-ready PaymentProvider over DbPool)
  ledger-orchestrator/ types.ts, ledger-orchestrator.ts, index.ts
  orchestrator/        types.ts, audit.ts, guard.ts, orchestrator.ts, index.ts
                       signer.ts  ← חדש v17 (HmacSigner, Ed25519Signer, generateAuditKeyPair)
                       pg-audit.ts ← חדש v16 (PgAuditStore)
  policy/              index.ts, policy-schema.ts, policy-compiler.ts
  potential/           types.ts, strength-mapper.ts, opportunity-router.ts,
                       potential-engine.ts, personality-types.ts,
                       personality-mapper.ts, success-path-router.ts,
                       collaboration-matcher.ts, index.ts
  escrow/              types.ts, escrow.ts, pg-escrow-store.ts, index.ts
                       pg-escrow-store.ts ← חדש v72 (PgEscrowStore — PostgreSQL-backed EscrowStore)
  track-record/        track-record.ts, track-record-cache.ts, pg-track-record-cache.ts, index.ts
                       track-record-cache.ts ← חדש v89 (TrackRecordCache interface + InMemoryTrackRecordCache)
                       pg-track-record-cache.ts ← חדש v89 (PgTrackRecordCache — PostgreSQL-backed TrackRecordCache)
  api-spec/            openapi.yaml (113 operationIds)
```

## ארכיון (תמצית)
v13-43 kernel+passport+SDK · v44-75 כלכלת-תיאום+לולאה · v76-85 lifecycle+research+trust-record · v86-109 **15 המחזורים: מוצר מוכן-ללקוחות** · v110 ביקורת-שחרור + אכיפת-מפתח.
v338-v367: **יעילות** — O(n)/O(1) replacements (jobs/risk/potential/transparency-log/ledger/pg-stores, ~15 מחזורים) · **PQC stage-2b tooling** — async resolver (v345), check-env visibility (v346), pre-flight env-checker + smoke-test + admin install endpoint (v353/v354/v360-361) · **ARD** — publisher adapter+route (v350) ו-verifier service (v351), threat-mitigation rows ב-SECURITY.md (v367) · **Frontend stack מלא** (FRONTEND_AND_ARD_BLUEPRINT.md §5, 10/10) — design-tokens (v349) → public verifier (v355) → cross-vendor audit-trail (v356) → approval-console+Slack (v357-358) → risk-intelligence explainability (v359) → policy dry-run+visualizer (v362-363) → component-primitive library (v364) → visual-regression harness+CLI (v365-366). v369: PQC `kid` via public-key derivation. v370: `canonicalTracePayload` pre-sorted key order. v371: DB tokenizer keyword Sets hoisted to module-level. v372: `canonicalSerialise` direct-write replaces sorted-tree intermediate in canonical-json. v373: PQC-sim secret CSPRNG fix (randomBytes, not Math.random). v374: single-pass solvency accumulation in `scoreEconomicInvariant`. v381: per-passport revocation (`lib/passport/passport-revocation-list.ts` + verifier, 18 טסטים) — passport יחיד נשלל בנפרד ממצב ה-kid. v385: `totp.ts` `BASE32_DECODE_MAP` O(1) lookup. v386: `RateLimiter.check/prune` binary-search O(log n). v387: witness co-signing core (`lib/transparency-log/witness.ts` — quorum, SplitViewError, 14 טסטים) + תיקון regression (executable bit). v388: Witness HTTP endpoints (`witness-registry.ts` + `witness-routes.ts`, 28 טסטים). v389: Reputation-proof freshness bound (`validUntil` על `TrustProofBundleV2`, 8 טסטים + SECURITY.md row). v390: OpenAPI backfill — witness-routes.ts הוכנס ל-spec ולסריקת drift-gate. v391: OpenAPI backfill — transparency-log-routes.ts (4 routes) הוכנס ל-spec ולסריקת drift-gate. v392: OpenAPI backfill — passport-revocation-routes.ts (3 routes) הוכנס ל-spec ולסריקת drift-gate. v393: OpenAPI backfill — mcp-routes.ts (1 route, mcpJsonRpcBridge) הוכנס ל-spec ולסריקת drift-gate. v397: `FederationAnchor` (§2.A-1) — anchor חתום שקושר root↔root בלי חשיפת-leaves. v398: `scoreRiskDrift` (§2.C-1) — OLS slope מעל חלון, driftScore [-100,100]. v399: `verifyCrossLogConsistency` (§2.A-2) — מאמת זוג FederationAnchors מול witness quorum משותף. v400: Mesh membership proof (§2.A-3, `mesh-membership.ts`, 11 טסטים) + תיקון regression (executable bit). v401: OpenAPI backfill — ard-routes.ts + pqc-admin-routes.ts (3 routes), כל קובצי-routes כעת ב-spec. v402: Predicate proof (§2.B-2, `predicate-proof.ts`, 26 טסטים) — threshold כ-BigInt אמיתי. v403: Quorum-in-verifier (§2.D-11) — `frontend/verifier` חושף witnessQuorum, 4 טסטים. v404: Redacted proof-bundle (§2.B-3, `redacted-proof-bundle.ts`) — verdict-only חשיפה, resourceRef/value מוסתרים. v405: Witness liveness/staleness monitor (§2.D-12, `witness-liveness.ts`, 14 טסטים). v406: Witness gossip protocol -sim (§2.D-10, `witness-gossip-sim.ts`, 14 טסטים) — משלים את §2.D במלואו. v407: Drift-triggered escalation hook (§2.C-8) — `scoreRiskDrift` מחובר ל-`assessRisk` דרך `maxApproval`, 6 טסטים. v408: Drift explainability (§2.C-9, `drift-explain.ts`, route `POST /api/risk/drift-explain`, 10 טסטים) — משלים את §2.A–§2.D במלואם (12/12 sub-steps). v409: single-pass witness verification (`count-proof.ts` — O(2n)→O(n), 2 טסטים). v410: O(1) Set-based witness intersection (`cross-log-consistency.ts`, 3 טסטים). v411: O(1) Set-based condition lookup ב-policy-compiler (`compileCondition`, 6 טסטים). v412: O(1) Set-based authorized-approvers lookup (`threshold-approval.ts`, 4 טסטים) + תיקון מספר-pass שגוי שירש מ-v411. v413–v414: Set-based scope lookup (`require-scope.ts`) + HybridSigner.verify() short-circuit. v415: Spend Budget Guard — cap מצטבר חוצה-ספקים, two-phase, 11 טסטים. v416: OpenAPI backfill — kid-resolver-routes.ts (3 paths). v417: Spend Budget Guard מחובר ל-orchestrator/guard chokepoint, 11 טסטים. v418: system-invariants test suite — 5 חוקי-ליבה + META מוכחים מול composition root אמיתי. v419: LAW 6 production-identity invariant, 2 טסטים. v420: Spend Budget HTTP routes + per-actor budgets, 5 endpoints, 14+1 טסטים. v421: Cross-vendor cost arbitrage primitive (`cost-arbitrage.ts`). v422: Billing-dispute proof primitive (`billing-dispute-proof.ts`, 27 טסטים). v423: Cost arbitrage HTTP route (`POST /arbitrage/quotes`, 17 טסטים). v424: Billing-dispute HTTP routes (build+verify, 13 טסטים). v425: Count-proof HTTP route (§2.B-1, `POST /api/track-record/count-proof`+verify, 10 טסטים). v426: Predicate-proof HTTP route (§2.B-2, `POST /api/track-record/predicate-proof`+verify, 10 טסטים). v427: Redacted-proof-bundle HTTP route (§2.B-3, `POST /api/track-record/redacted-proof-bundle`+verify, 10 טסטים). v428: O(1) Set-based state-machine transition lookup — `VALID_TRANSITION_SET` (`execution-workflow.ts` + `pg-execution-store.ts`), 3 טסטים. v429: single-pass replay() ב-`pg-execution-store.ts` (ביטול מערך-ביניים, 3 טסטים).
