# CLAUDE.md — ECOS Master Session File
**גרסה נוכחית:** V257-complete | **Phase:** P153 | **תאריך:** 2026-06-01

---

## 🚀 קרא זה ראשון — בכל סשן, בכל AI

זהו ה-ZIP הקנוני של ECOS V219. הוא נקי, ממוקד, ומסודר לשימוש AI.
**כל עבודה חדשה מתחילה כאן.**

---

## 🗺️ מבנה ה-ZIP

```
ecos_v216_canonical/
│
├── CLAUDE.md                        ← אתה כאן — קרא ראשון
├── AI_PROTOCOL_V212.md              ← חוקי ברזל + contracts (בסיס, אל תשנה)
├── AI_PROTOCOL_V219.md              ← contracts הנוכחיים (הכי חשוב)
├── AI_PROTOCOL_V215-218.md          ← היסטוריה (לצורך הבנת chain)
│
├── docs/
│   ├── NARRATIVE.md                 ← ה-vision של המוצר
│   ├── ECONOMY.md                   ← כלכלה: split 40/40/20, reputation, decay
│   └── RESEARCH_PROMPT_V2.md        ← פרומט מחקר מלא — להעביר ל-researchTool
│
├── artifacts/                       ← כלי AI — להדביק ב-Claude כ-React artifact
│   ├── ecosNavigator216.jsx         ← ✅ CURRENT: Dashboard + ZIP context extractor
│   └── researchTool216.jsx          ← ✅ CURRENT: AI research tool (prompt V2 מובנה)
│
├── ecos-api-server.js               ← שרת ראשי (V214 base — ראה הערות merge)
├── ecos-api-server-v218-patch.js    ← endpoints V218 (ממתין לאיחוד)
├── ecos-api-server-v219-patch.js    ← endpoints V219 (ממתין לאיחוד)
│
├── src/lib/                         ← 133 שירותי צד-שרת (הגרסה הנוכחית)
│   ├── fiatLedger.js                ← 🔒 SACRED — לא לגעת בכלל
│   ├── auditLog.js                  ← 🔒 SACRED — לא לגעת בכלל
│   └── ... (131 שירותים נוספים)
│
├── lib/                             ← 30 engines ייחודיים שאינם ב-src/lib
│   ├── agentConsensusEngine208.js
│   ├── disputeArbiter210.js
│   ├── governanceVoting211.js
│   └── ...
│
├── tests/                           ← 238 קבצי test מ-V214 + V216-V219
├── apps/web/                        ← Next.js frontend
├── sdk/                             ← SDK types + index
├── db/, middleware/, scripts/       ← תשתית
└── CHANGELOG_V200-V209.md           ← 8 changelogs אחרונים
```

---

## ⚡ Pre-flight — בצע בתחילת כל סשן

```bash
# 1. בדוק קבצים קדושים
md5sum src/lib/fiatLedger.js src/lib/auditLog.js
# Expected: 563e9b1f… / e5a5c2c2…
# אם שונה — עצור הכל. אל תמשיך.

# 2. בדוק syntax של patches
node --check ecos-api-server-v218-patch.js
node --check ecos-api-server-v219-patch.js

# 3. הרץ tests (חייב לעבור הכל)
NODE_ENV=test node tests/v216.test.js
NODE_ENV=test node tests/v217.test.js
NODE_ENV=test node tests/v218.test.js
NODE_ENV=test node tests/v219.test.js
```

---

## 📋 חוקי ברזל (R1–R7) — לכל גרסה ללא יוצא מן הכלל

| חוק | תיאור |
|-----|--------|
| **R1** | `fiatLedger.js` + `auditLog.js` — קדושים. לא לגעת. MD5 בתחילת כל סשן. |
| **R2** | כל identifier חדש מסתיים ב-suffix של הגרסה (למשל `_store220`, `createEscrow220`) |
| **R3** | אפס תלויות npm חדשות. רק Node.js built-ins או in-memory. |
| **R4** | כל test exports בתוך `if (process.env.NODE_ENV === 'test')` בלבד. |
| **R5** | `package.json` version מתעדכן עם כל ZIP קנוני. |
| **R6** | אין למחוק endpoints קיימים. |
| **R7** | אין ליצור store חדש אם קיים אחד שמשרת את אותה מטרה. |

---

## 🧠 מצב המערכת — מה ממומש עד V219

### In-Memory Stores (מצטברים)

| Store | משתנה | גודל מקסימלי | נוסף ב- |
|-------|--------|--------------|---------|
| Event Log | `_eventLog181` | unbounded | V181 |
| Escrows | `_escrows215` | 20,000 (ring) | V215 |
| Onboard Log | `_onboardLog215` | 5,000 (ring) | V215 |
| Rep Snapshots | `_repSnapshots216` | 10,000 (ring) | V216 |
| Leaderboard Snaps | `_leaderboardSnapshots217` | 5,000 (ring) | V217 |
| Score History | `_scoreHistory218` | 8,000 (ring) | V218 |
| V219 | — | אפס stores חדשים | V219 |

### Endpoints פעילים — V215 עד V219

**V215 (P102):** `POST/GET /workspaces/:id/agent-escrow` · `GET /members/:uid/sybil-score` · `POST /onboard`

**V216 (P103):** `POST /tasks/:tid/rep-snapshot` · `GET /tasks/:tid/rep-snapshot/diff` · `GET /tasks/:tid/activity-heatmap` · `POST /escrows/sweep-expired` · `GET /onboard/analytics`

**V217 (P104):** `POST /validators/leaderboard-snapshot` · `GET /validators/leaderboard-history` · `GET /tasks/:tid/completion-rate` · `GET /members/:uid/reputation-decay-sim` · `POST /members/batch-sybil-check`

**V218 (P105):** `POST /validators/:uid/score-history` · `GET /validators/:uid/score-trend` · `GET /treasury/flow-summary` · `GET /governance/proposals/tally` · `GET /members/:uid/activity-window`

**V219 (P106 — stateless כולם):** `GET /health-score` · `GET /validators/:uid/performance-index` · `POST /workspaces/batch-summary` · `GET /validators/:uid/score-percentile` · `GET /events/replay`

---

## ⚠️ בעיות פתוחות — לטיפול ב-V220

### 1. ecos-api-server.js עדיין V214 בלבד
endpoints של V215–V219 יושבים ב-patches נפרדים. לאחד:
```javascript
// בסוף ecos-api-server.js:
const { registerV218Endpoints } = require('./ecos-api-server-v218-patch');
const { registerV219Endpoints } = require('./ecos-api-server-v219-patch');
registerV218Endpoints(app, _scoreHistory218, _eventLog181);
registerV219Endpoints(app, _scoreHistory218, _eventLog181);
```

### 2. lib/ vs src/lib/ — שני עולמות
- `src/lib/` — שירותי V215+ (133 קבצים, עדכניים)
- `lib/` — engines מ-V208-V212 (30 קבצים, טרם הועברו)

**החלטה נדרשת ב-V220:** להעביר engines ל-`src/lib/` או להשאיר נפרד עם index.

### 3. tests/ — V216-V219 לא מחוברים ל-vitest
`vitest.config.js` מוגדר ל-V214 בלבד. יש לעדכן.

---

## 🎨 כיצד להשתמש ב-Artifacts

### ecosNavigator216.jsx
**מה זה:** Dashboard + ZIP context extractor. מנתח את ה-ZIP ומייצר session block מוכן.
**שימוש:** העתק `artifacts/ecosNavigator216.jsx` → הדבק ב-Claude כ-React artifact → גרור ZIP לתוכו → העתק את ה-session block שנוצר לסשן חדש.

### researchTool216.jsx
**מה זה:** כלי מחקר AI-powered עם prompt V2 מובנה — שולח queries ל-Anthropic API ומציג תוצאות מובנות.
**שימוש:** העתק `artifacts/researchTool216.jsx` → הדבק ב-Claude כ-React artifact → לחץ הפעל.
**גרסה מלאה של ה-prompt:** ראה `docs/RESEARCH_PROMPT_V2.md`.

---

## 📦 איך ליצור ZIP220 בסוף סשן

```bash
# 1. עדכן גרסה
# CLAUDE.md → גרסה 220
# צור AI_PROTOCOL_V220.md (כבר קיים כ-Draft)
# צור NEXT_SESSION_PROMPT_V220.md

# 2. אחד patches לשרת הראשי (P107-A)

# 3. עדכן artifacts אם השתנו
# artifacts/ecosNavigator220.jsx
# artifacts/researchTool220.jsx

# 4. צור ZIP
cd ..
zip -r ecos_v220_canonical.zip ecos_v219_canonical/ \
  --exclude "*.DS_Store" \
  --exclude "*/__pycache__/*" \
  --exclude "*/node_modules/*"
# → שלח ✓
```

---

## 🔮 הצעות ל-V220 (P107)

- [ ] **P107-A** — אחד patches לתוך `ecos-api-server.js` (גבוהה — בלוקר)
- [ ] **P107-B** — העבר engines מ-`lib/` ל-`src/lib/` (בינונית)
- [ ] **P107-C** — חבר `vitest.config.js` ל-tests V216-V219 (בינונית)
- [ ] **P107-D** — Workspace federation: `_federation220` store + 3 endpoints (נמוכה — feature)
- [ ] **P107-E** — Agent marketplace: listing + discovery של agents (נמוכה — feature)

---

*ECOS V219-canonical | Phase P107 | 2026-06-01 | נוצר ע"י Claude*
