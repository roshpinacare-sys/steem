# TFA — Frontend & ARD Trust-Layer Blueprint (canonical, agent-facing)

> **מקור-האמת למצב הקוד הוא תמיד `MANIFEST.md`.** המסמך הזה הוא **כיוון-מוצר ותכנון**
> עבור שני workstreams חדשים (Frontend + ARD), לא דיווח-מצב. מספרים, גרסאות ו"מה נבנה"
> נלקחים מ-`MANIFEST.md` בלבד. אם משהו כאן סותר את ה-MANIFEST — ה-MANIFEST מנצח.
>
> סוכן שמתחיל מחזור על אחד מה-workstreams האלה: קרא את החלק הרלוונטי כאן → קח את
> ה-sub-step הפתוח הראשון מהבקלוג הממוספר → ממש את הגרסה הקטנה-נכונה עם טסט →
> עדכן MANIFEST/STATUS/RUNBOOK כרגיל. **sub-step אחד במחזור.**

---

## 0. למה המסמך הזה קיים (קרא פעם אחת)

עד היום TFA הוא backend trust-control-plane בלבד (אפס-תלות, זה נשאר נעול). שני דברים
משתנים את מפת-ההזדמנות ב-2026:

1. **ARD (Agentic Resource Discovery)** — ספק פתוח שפורסם ב-17 ביוני 2026 ע"י קואליציה
   (Google, Microsoft, GitHub, Hugging Face, Cisco, Databricks, Nvidia, Salesforce,
   ServiceNow, Snowflake ועוד). זו שכבת-הגילוי שמעל MCP/A2A/OpenAPI: סוכן מוצא יכולת,
   בוחר ביניהן, ו**מאמת שבטוח להתחבר אליה**. ה-spec הוא v0.9 draft (מתוארך 28/05/2026,
   Apache 2.0). זו ההזדמנות שבה TFA הופך מ"עוד trust gate" ל**מקור-אטסטציה מובנה בתוך
   תקן-תעשייה**.

2. **Frontend** — היום אין UI. שלושת המשטחים הקריטיים (verifier ציבורי, audit-trail
   חוצה-vendor, approval console בזמן-אמת) הם ה-surface שבו לקוח/CISO/מפתח פוגש את TFA.
   ה-frontend נבנה כ**workspace package נפרד** עם תלויות build-time בלבד, כדי שהאילוץ
   "אפס-תלות ב-backend" יישאר נעול.

**העיקרון המנחה:** ARD נותן את שכבת-האמון את ה-namespace (identity/JWS/attestations),
אבל **לא** מחייב Ed25519 או W3C VC. ה-Ed25519 proofs/passports + AP2-linked VCs של TFA
הם **superset** — לכן TFA יכול להיות ה-URI ש"כולם מצביעים עליו" כמקור-אטסטציה
גבוה-אמינות. זה ה-wedge.

---

## 1. ה-thesis ל-ARD (שלושה מהלכים, לפי סדר)

ARD מגדיר שני primitives: manifest סטטי ב-`/.well-known/ai-catalog.json`, ו-registry
`POST /search`. שכבת-האמון היא אובייקט אופציונלי `trustManifest` עם חמישה שדות:

| שדה | חובה? | תוכן | המיפוי של TFA |
|---|---|---|---|
| `identity` | חובה | SPIFFE ID / DID / HTTPS FQDN URI | `did:web:<domain>` או SPIFFE; חייב להתיישר עם authority ה-URN |
| `identityType` | אופ' | `"did"` / `"spiffe"` / `"https"` | נגזר מ-`identity` |
| `attestations` | מערך | `{type, uri, digest?}` | `type: "TFA-VerifiedProvenance"`, `uri` → deep-link ל-verifier, `digest` → Merkle leaf hash |
| `provenance` | מערך | `{relation, sourceId, sourceDigest?}` | `relation: "publishedFrom"`, `sourceId` → cross-vendor agent identity |
| `signature` | אופ' | detached JWS על ה-manifest | JWS שעוטף את ה-Ed25519 proof של TFA |

מזהי-סוכן הם `urn:ai:<publisher-FQDN>:<namespace>:<agent-name>` (RFC 8141). ה-FQDN הוא
trust-anchor שחייב להצליב מול `trustManifest.identity`. registries תומכים ב-dot-path
filtering כמו `trustManifest.attestations.type: ["SOC2-Type2"]`.

**שלושת המהלכים (כל אחד = כמה sub-steps בבקלוג למטה):**

1. **Publish** — TFA פולט `/.well-known/ai-catalog.json` תקין-spec עם `trustManifest`
   מלא (identity + detached JWS), כך שסוכני Copilot/Gemini/Claude מגלים את ה-trust-gate
   ברגע שהם צריכים אותו.
2. **Be the referenced authority** — ה-inclusion-proofs מה-transparency-log וה-Ed25519
   passports ממופים ל-ARD `attestations`/`provenance`. כי ה-trust הילידי של ARD הוא
   "bring-your-own-attestation-URI", TFA יכול להיות ה-URI.
3. **Verify others** — שירות ARD-aware: בהינתן `urn:ai:...`, בדוק שה-domain של
   `trustManifest.identity` תואם את authority ה-URN (דרישת-היושרה של ה-spec עצמו),
   אמת את ה-JWS, ופתור attestation digests. זה ה-cross-vendor provenance product
   כצד-שלישי ניטרלי.

**אזהרות-יישום (חובה לכבד):**
- ARD הוא v0.9 draft; שדות/טיפוסים עשויים להשתנות, ורישומי IANA media-type עדיין
  ממתינים. **בנה את ה-publisher מאחורי adapter דק** (כמו כל integration חיצוני).
- נוהל אימות-החתימה/פתרון-המפתח המלא של ARD נדחה ל-spec-repo חיצוני שלא נקרא במלואו
  כאן. **אַמת את אלגוריתם ה-JWS ופתרון-המפתח המדויק לפני שמשחררים את ה-verifier.**
- ARD נוקב ב-SPIFFE/DID/JWS אבל **לא** ב-Ed25519/W3C-VC. ה-interop דורש **לעטוף** את
  ה-TFA proofs במעטפת ש-ARD מצפה לה (attestation URIs + detached JWS), לא להניח
  ש-registries צורכים Ed25519 ילידית. (תקדים Hugging Face עם catalog חתום-Ed25519
  מוכיח שה-layering הזה אפשרי.)

---

## 2. הנון-נגושיאבלז של ה-Frontend (אכיפה כמו CLAUDE.md)

אלה כללים קשיחים. סוכן ש-frontend עליו לכבד את כולם, אחרת המחזור void:

1. **אפס תלות-ריצה ב-backend.** ה-frontend הוא **workspace package נפרד** עם תלויות
   build-time בלבד. ה-bundle הוא static, tree-shaken. אסור שייבוא frontend ידלוף
   ל-backend.
2. **בלי Inter / Roboto / Open Sans.** משפחת variable אחת ייחודית (מועמדים: Mona Sans
   — GitHub, SIL OFL, ~85KB variable; או Space Grotesk) + mono אחד (Geist Mono /
   JetBrains Mono) ל-hashes/receipts/signatures/tabular figures.
3. **OKLCH בלבד** לצבע. הרמפה הקנונית בסעיף 4. בלי hex/HSL בקוד-קומפוננטות —
   רק semantic tokens.
4. **שש מצבים מעוצבים לכל control אינטראקטיבי:** hover / focus / active / disabled /
   loading / empty. זה הסף, לא bonus.
5. **בלי raster assets.** אייקונים = inline SVG. פונטים = variable. בלי icon-font,
   בלי PNG/JPG bloat.
6. **CSS-first motion** שמכבד `prefers-reduced-motion`. page-load אחד מתוזמר עם
   staggered reveals (animation-delay 100–200ms), interruptible, עמיד תחת
   input מהיר/חוזר.
7. **Light-first.** מוצר-אמון מרגיש כמו אור-יום/שקיפות, לא טרמינל-האקר. accent
   pale-cyan אחד עושה את כל העבודה (primary action + verified-state + brand wash).
   צבעים סמנטיים (ירוק=valid, אדום=deny, ענבר=needs-approval) שמורים **רק** למשמעות-verdict.

**ה-stack המומלץ:** Preact + Signals + Vite + CSS custom properties. (Preact core
≈3KB gzipped מול React ≈40KB; Signals = fine-grained reactivity ל-live updates ב-approval
console.) target: bundle <60KB gzipped, full proof-chain renders <1s, WCAG AA contrast
בשני המצבים עובר ב-CI.

---

## 3. שבעת המשטחים (מה לבנות, ואיך כל אחד best-in-class)

1. **Public verifier (ה-moat).** שדה-הדבקה יחיד (receipt/passport/proof) → אימות
   server-side → verdict. permalink משותף לכל אימות. הצג את **כל** השרשרת:
   signature valid ✓, key identity, Merkle inclusion-proof מול signed tree-head,
   transparency-log index, timestamp — כמו ש-`search.sigstore.dev` חושף Rekor entries.
   רנדר invalid states בצורה פורנזית בדיוק כמו valid. זה המסך שצריך להיות
   הכי-מלוטש במוצר.
2. **Cross-vendor audit-trail dashboard.** trail אחד מעל xAI/OpenAI/Anthropic/Google/
   custom. סינון לפי provenance/vendor/risk/policy-outcome. משמעת Datadog: overview
   גבוה-מבט → drill בלחיצה לפרט-פעולה; template variables (vendor/env/risk-tier);
   הבנה תוך <5 שניות של "האם משהו לא תקין עכשיו". timeline + טבלה מסוננת + התפלגות-סיכון.
3. **Real-time approval / HITL console.** כאן HITL נכשל הכי הרבה (reviewers הופכים
   ל-rubber-stamps). אסקלציה **רק** לפעולות באמת מסוכנות/דו-משמעיות/בלתי-הפיכות.
   כל card: סיכום-החלטה, ה-fused risk score עם הפקטורים, ה-policy שהפעיל אסקלציה,
   Approve/Deny עם reason חובה ב-deny. עדכוני-מצב תת-שנייה דרך Signals. הצג "מה יקרה
   אם תאשר" ו-reversibility. multi-channel (web + Slack/SMS, דפוס `require_approval`).
4. **Policy editor/visualizer.** ייצוג ויזואלי של ענפי auto/human/threshold-escrow/deny;
   diff/versioning; dry-run מול פעולות היסטוריות ("אילו ה-policy היה חי שבוע שעבר,
   N פעולות היו מוסלמות").
5. **Risk-intelligence explainability.** חשוף את ה-fusion (contextual+reputation):
   תרומת כל פקטור לציון-הסופי (לא black-box), היסטוריית-מוניטין של הסוכן/vendor,
   והאותות-ההקשריים. עונה על "למה זה היה מסוכן?" עבור compliance.
6. **Receipts/passports browser + settlement/escrow views.** טבלאי, mono numerals,
   סכומי BigInt micro-cent מדויקים; double-entry ledger כ-debits/credits מזווגים;
   escrow state-machine (held → milestone-released → settled/refunded) מוויזואל;
   כל שורה מקושרת ל-permalink האימות הציבורי.
7. **Developer onboarding.** API keys, MCP setup (~15 tools), CLI, ו**חדש**: flow
   "Publish to ARD" בלחיצה שמייצר את ה-`/.well-known/ai-catalog.json` + `trustManifest`
   של הארגון. ברמת Resend/Clerk/WorkOS: snippets מוכנים-להדבקה, בדיקת-מפתח חיה,
   סקשנים בסגנון-טרמינל.

---

## 4. מערכת-העיצוב (tokens קונקרטיים — מקור-אמת לעיצוב)

**שלוש שכבות:** primitives (רמפה) → semantic tokens → component tokens. dark mode
הופך **רק** את שכבת ה-semantic ע"י L-inversion.

רמפת ה-cyan (hue ≈ 220–230°, L מוחזק בצעדים, chroma מותאם להימנע מ-sRGB clipping):

```css
--cyan-50:  oklch(0.97 0.020 225);
--cyan-100: oklch(0.93 0.040 225);
--cyan-200: oklch(0.86 0.070 224);
--cyan-300: oklch(0.75 0.100 223);
--cyan-400: oklch(0.65 0.130 222);
--cyan-500: oklch(0.54 0.140 221); /* primary accent */
--cyan-600: oklch(0.45 0.130 221);
--cyan-700: oklch(0.37 0.110 221);
--cyan-800: oklch(0.27 0.080 221);
--cyan-900: oklch(0.19 0.055 221);
--cyan-950: oklch(0.13 0.040 221);
```

- **Neutrals cyan-tinted** (לא gray טהור): hue ≈225° ב-chroma נמוך מאוד (~0.006–0.012).
- **Text** near-black `oklch(0.20 0.01 240)` (לעולם לא `#000`). **Canvas** `oklch(0.99 0.004 225)`.
- **Semantic:** valid `oklch(0.62 0.16 150)` · invalid/deny `oklch(0.58 0.20 25)` ·
  approval-pending `oklch(0.72 0.15 75)`.
- **semantic tokens:** `--color-surface`, `--color-surface-elevated`,
  `--color-border-hairline`, `--color-text`, `--color-text-muted`, `--color-accent`,
  `--color-verified`, `--color-danger`.
- **states:** hover = +5L (light) / −5L (dark); active = −5L (light) / +5L (dark);
  disabled = low C + low contrast.
- **spacing:** 4px base. משטחים צפופי-נתונים → paddings 4/8/12 (לא 16/24).
  grid 12-טורים; test ב-1280px וב-2560px.
- **depth (Linear):** 1px inset hairline borders + shadows רכים בטמפרטורת-מותג,
  לא fills כבדים.
- **signature visual (ה-moat):** מוטיב "verifiable proof" — חותם/וי שמחשב גלויות:
  paste → hash-shimmer דטרמיניסטי קצר → verdict VALID/INVALID חד עם signature/Merkle
  path/timestamp כ-"proof ribbon" ייחודי. טקסטורת guilloché/blueprint-grid עדינה
  ב-CSS/SVG באטימות נמוכה מאוד = ה-equivalent ה-ownable ל-"Vercel grid".

---

## 5. הבקלוג — bounded, tested, sub-step אחד למחזור

כל פריט נמסר באבני-בניין קנוניות, אחת למחזור, עם טסט (happy + edge + fail-closed).
**הסדר הוא סדר-ערך.** tokens קודם — הכל תלוי בהם.

1. **Design-token foundation** — tokens → primitives → semantic → dark-mode L-inversion
   → contrast CI gate. עדיפות עליונה.
2. **ARD publisher** — פלוט `/.well-known/ai-catalog.json` תקין עם `trustManifest`
   (identity + detached JWS); conformance מול כלי-ARD הרשמי; מפה TFA proofs →
   `attestations`/`provenance`. מאחורי adapter דק (v0.9 draft).
3. **ARD verifier service** — בהינתן `urn:ai:...`, אמת יישור domain↔identity, JWS,
   ו-attestation digests; חשוף כ-MCP tool + UI ציבורי. אַמת alg ה-JWS לפני שחרור.
4. **Public verifier as product** — paste→verdict עם רנדור מלא של Merkle/inclusion-proof
   ו-permalinks משותפים.
5. **Cross-vendor audit trail** — event-model מאוחד + filter engine + dashboard
   ברמת-Datadog.
6. **Real-time approval console** — Signals live updates + risk-factor explainability
   + Slack channel.
7. **Risk-intelligence explainability** — מבט factor-attribution מעל ה-fusion engine.
8. **Policy visualizer + dry-run** מול פעולות היסטוריות.
9. **Component primitive library** — buttons/inputs/tables/cards של שש-המצבים כ-kit הקנוני.
10. **Visual-regression harness** שרץ ב-zero-dep sandbox (snapshot/DOM tests).

---

## 6. שיטת-הבנייה הקנונית עם סוכנים

- **סדר:** design tokens → component primitives → screens. אל תדלג.
- **encode החלטות** בקובץ design-language קריא-מכונה + token-file שהסוכנים מתייעצים
  בו כל מחזור (כמו Claude Design שמאמת פלט מול design-system מיובא לפני הצגה).
- שמור `AGENTS.md`/`CLAUDE.md` ל-frontend עם הנון-נגושיאבלז מסעיף 2 (no Inter; OKLCH
  only; six states; zero runtime deps in backend; SVG/variable-font only).
- **ZIP רזה:** build-time deps בלבד, tree-shaking, בלי raster.
- **טסטים ב-zero-dep sandbox:** snapshot/DOM + visual-regression harness קל;
  sub-step ממוקד אחד-מטוסט למחזור.

---

## 7. רף לשינוי-עדיפויות

- אם אימוץ ARD נתקע (registries לא מצביעים על attestation URIs חיצוניים) — הורד
  עדיפות ל-"referenced authority" (מהלך 2 בסעיף 1), והכפל מאמץ על ה-public verifier
  העצמאי כ-wedge.
- אם מתחרה משחרר trust-layer ניטרלי ל-ARD קודם — האץ את שלב-ARD לפני ליטוש-Stage-1.

---

## 8. קביעטים (אמינות-מקורות)

- ARD v0.9 הוא Proposal status; שדות/טיפוסים עשויים להשתנות — adapter דק חובה.
- נוהל אימות-החתימה המלא של ARD לא נקרא כאן במלואו — אַמת JWS alg/key-resolution
  לפני שחרור ה-verifier.
- הפרופורציה המדויקת "כ-3/4 מ-SaaS עיצובי הם dark+neon" אינה מאומתת עצמאית — קח את
  ה-pattern כמתועד אך את האחוז כ-directional.
- הפניות-עיצוב (Stripe Söhne, Linear Inter, Vercel Geist) מתועדות second-hand בבלוגי-ניתוח
  — קח hex/weight מדויקים כ-directional.
- כמה datapoints על agent-payments (Coinbase/Cobo/Crossmint) מגיעים מבלוגי-vendor —
  אַמת מול spec ראשי לפני התחייבות ארכיטקטונית.

---

*נוצר v348 (Claude). מקור: מחקר "TFA Frontend & ARD Trust Layer". כיוון-מוצר —
מצב-הקוד הקנוני הוא `MANIFEST.md`.*
