# TFA — מצב הפלטפורמה, מוכנות-פיילוט, ותוכנית-מוצר (v248)

> מסמך-בוס. נכתב כדי לענות בדיוק: **איפה אנחנו עומדים, מתי אפשר פיילוט ברמה גבוהה, ולמה משתמש ישלם.**
> הכלל המנחה: **מרחיבים את הפלטפורמה, לא משנים אותה.** כל היכולת הקיימת נשמרת; כל מחזור מוסיף ערך additive.

---

## 1. איפה אנחנו עומדים (מצב אמת, v248 — 284/0/0, אפס רגרסיה)

### מנוע-האמון (core) — בנוי ועובד (offline-verified)
- **סיווג-סיכון server-side** — taxonomy מלא (file/shell/git/db/infra + DeFi: token.swap/liquidity/bridge/approve). ה-`riskClass` נגזר בשרת, לא נסמך על הלקוח. *(מול OPA/Cedar שעונים רק "מורשה?")*
- **ExecutionReceipt נייד ששורד key-rotation** — KeyRing + **kid end-to-end** (receipt נושא kid, verifier פותר דרך היסטוריית-מפתחות). *(מול MetaMask: proof on-chain בלבד; מול Okta: לוג, לא proof נייד)*
- **Transparency-log / Merkle anchoring** — verify-after-revocation, inclusion proofs. *(הבידול החזק מול observability/compliance)*
- **KillSwitch מחובר** — emergency-stop global/tenant/action, fail-closed, מחווט ל-adapter+routes+composition.
- **pre-action simulation/dry-run** — ניבוי אפקט (reversible/blastRadius/valueAtRisk) לפני אישור. *(הכללה של ה-simulation של MetaMask לכל פעולה)*
- **post-quantum HybridSigner** (Ed25519 + ML-DSA) + Ed25519-first default.
- **escrow/ledger** (BigInt μ¢, double-entry), threshold approvals, signed webhooks, nonce/replay protection.
- **MCP server** (5 trust tools) + **POST /api/mcp** HTTP bridge עם scope auth — נכנס לכל סוכן (Claude/Cursor/LangGraph).
- **ops:** healthz/readyz, graceful shutdown, Pg stores, contract-tests.

### מה שנבנה ב-v248
- **RateLimiter רב-tenant** (sliding-window, per tenant/actor/action, fail-closed) — סוגר את פער ה-DoS/עלות (gap #17). *primitive בנוי+נבדק; חיווט ל-routes = המשימה הבאה.*

---

## 2. Scorecard מוכנות-פיילוט (מול צ'קליסט-המחקר — OWASP Agentic / NIST AI RMF)

| תחום | סטטוס | פער שנותר לפיילוט-רמה-גבוהה |
|---|---|---|
| סיווג-סיכון server-side | ✅ | — |
| portable proof + key-rotation | ✅ | — |
| transparency-log / verify-after-revocation | ✅ | — |
| KillSwitch / circuit-breaker | ✅ | — |
| simulation / dry-run | ✅ (primitive) | חיווט ל-decision-trace/receipt |
| replay / nonce | ✅ | — |
| PQC hybrid signatures | ✅ | — |
| MCP + HTTP bridge + scopes | ✅ | — |
| health / readyz / graceful shutdown | ✅ | — |
| **rate-limiting** | 🟡 (primitive v248) | **חיווט ל-routes** |
| **idempotency middleware** | 🟡 חלקי | מרכזי על endpoints משני-מצב |
| **OpenAPI truthfulness** | 🟡 | contract-test שאוסר drift |
| **RUNBOOK / backup-restore drill / RTO-RPO** | 🟡 | מסמך תפעול + drill מתועד |
| **SDK / CLI / GitHub Action** (wedge) | 🔴 | אריזת SDK npm + CLI (MCP קיים) |
| **Dashboard UI** | 🔴 | ראו §4 |

**שורה תחתונה:** מנוע-האמון **בשל לפיילוט**. מה שחסם פיילוט *רציני* כבר נסגר ברובו; מה שנשאר הוא (א) כמה חיווטי-תפעול קטנים, (ב) **משטח-המוצר** (UI + SDK) שבלעדיו שותף-פיילוט לא *רואה* את הערך.

---

## 3. מתי פיילוט? (תשובה כנה, מדורגת)

- **פיילוט-טכני (design partner ידידותי) — עכשיו.** ה-API + MCP + receipts ניידים עובדים. שותף אחד (פלטפורמת agentic-coding/devtools) יכול לחבר את ה-MCP, לגזור פעולות מסוכנות (file.delete/db.migration/infra.apply), ולקבל proof בר-אימות. **תנאי-כניסה:** חיווט rate-limit + idempotency + RUNBOOK (≈2–3 מחזורים).
- **פיילוט ברמה גבוהה (הציפייה שלך) — לאחר UI + SDK.** כדי שלקוח יתרשם וישלם, הוא צריך **Dashboard** (לראות approvals, receipts, ולאמת proof בלחיצה) ו-**SDK/CLI** (אינטגרציה ב-10 דקות). זה §4–§5. הערכה: זה ה-frontier הבא אחרי סגירת ה-🟡.
- **המוכנות נמדדת ב-truth-island, לא ברוחב:** flow מלא ומאומת intent→approval→(simulation)→execution→settlement→passport→verify. זה מה שמוכרים בפיילוט.

---

## 4. UI חכם — תוכנית (איך המשתמש הכי מרוצה)

עיקרון: **המוצר הוא ה-proof — ה-UI הופך proof מופשט למשהו שרואים, סומכים עליו, ופועלים לפיו תוך שניות.**

1. **Trust Console (לב המוצר):** feed חי של ActionIntents → לכל אחד riskClass, simulation (האפקט הצפוי לפני אישור!), והחלטה (auto/human/deny). כפתור **Approve/Deny** עם הקשר מלא — לא black-box.
2. **Receipt Verifier (הווידג'ט שמוכר):** הדבק/גרור receipt → ✅/❌ offline, כולל אימות מול היסטוריית-מפתחות (גם אחרי rotation) ו-inclusion proof ב-transparency-log. "אמת בעצמך, בלי לסמוך עלינו" — זה ה-wedge מול כולם.
3. **Policy Studio:** עריכת מדיניות סיכון/ספי-אישור/escrow כ-DATA, עם simulation לפני שמירה.
4. **Kill-Switch panel:** עצירת-חירום global/tenant/action בלחיצה, עם audit.
5. **Spend & Savings:** כמה פעולות מסוכנות נחסמו/אושרו, ערך-בסיכון, וזמן/כסף שנחסך (ראו §5).
6. **Multi-tenant מובנה:** בידוד מלא, rate-limit פר-tenant גלוי, RBAC.

חוויית-יסוד: **drop-in MCP** → תוך דקות הסוכן של הלקוח כבר עובר דרך השער; ה-UI מראה את הערך מהפעולה הראשונה.

---

## 5. למה משתמש ישלם (מנוי) + חיסכון חכם

**הכאב:** סוכן אוטונומי שמבצע פעולות מסוכנות = סיכון קטסטרופלי (תקרית Replit: מחיקת DB ב-prod תחת code-freeze). חברה שמריצה סוכנים *חייבת* שער-אמון בר-הוכחה — או שהיא לא יכולה להעלות סוכנים ל-production בכלל.

**הצעת-הערך (לא רק סיפור — מגובה בקוד שקיים):**
- **מונע אסון:** simulation + gating + KillSwitch עוצרים את הפעולה ההרסנית *לפני* שקרתה.
- **proof שמוכר אמון:** receipt נייד בר-אימות-offline = הלקוח מוכיח ל-*הלקוחות שלו* ולמבקרים שהסוכן גודר ומבוקר. *(Vanta מוכיח פוסטורה ארגונית; אנחנו מוכיחים כל פעולה)*
- **ניטרליות:** עובד חוצה-vendor/chain. *(MetaMask/Catena הם vendors שלא יכולים להיות בוררים של עצמם)*

**חיסכון חכם למשתמש (מנוף-המנוי):**
- **תמחור per-check/per-receipt/per-verify** — משלם לפי שימוש, לא רישיון ענק.
- **חיסכון מדיד:** כל פעולה הרסנית שנחסמה = שעות-שחזור/נזק שנמנע; ה-Dashboard מציג "X פעולות בסיכון-גבוה נחסמו / $Y ערך-בסיכון נשמר" — ה-ROI גלוי.
- **חיסכון תפעולי:** auto-approve מתועד לפעולות בטוחות (לא כל דבר עובר אדם) → פחות חיכוך, אישור-אדם רק כשצריך.
- **שכבת-חינם:** N בדיקות/חודש (כמו x402: 1,000 free) → אימוץ נגיש, מנוי כשגדלים.

---

## 6. הצעד הבא (מחזורים קרובים — סדר ערך)
1. **חיווט RateLimiter ל-routes** (השלמת gap #17) + idempotency middleware מרכזי.
2. **חיווט simulation ל-decision-trace/receipt** — האפקט-הצפוי נחתם ונראה למאשר.
3. **RUNBOOK + backup/restore drill + RTO/RPO** (מסמך תפעול לפיילוט).
4. **SDK npm + CLI** (wedge — אינטגרציה ב-10 דק').
5. **receipt תואם W3C VC 2.0 / AP2** (interop moat — משתרשר ל-Mandates).
6. **Dashboard UI** (Trust Console + Receipt Verifier) — משטח-המוצר לפיילוט-רמה-גבוהה.
