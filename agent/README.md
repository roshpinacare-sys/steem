# SAOS Agent — סוכן מקומי אוטונומי (headcorner)

דימון קטן (Node.js) שרץ **על המכונה של המפעיל** 24/7 ומבצע אוטומטית את מה
שהמפעיל היה צריך לעשות ידנית בקונסולה. v0.2.0 — חמישה לופים:

1. **תביעת פרסים אוטומטית** — כל X דקות בודק את יתרות ה-VESTS/STEEM/SBD הממתינות
   של החשבון, ואם עברו את הסף — מבצע `claim_reward_balance`.
2. **צופה חלון BOT-3** — כל Y דקות קורא את ה-feed וספר ההזמנות מהשרשרת, מחשב את
   ה-edge של מחזור ההמרה SBD→STEEM→SBD על 100 SBD, ומתריע בלוג כשהחלון
   **נפתח (≥10%) או נסגר**.
3. **צופה העברות נכנסות** — סריקת transfer נכנסים (קריאה-בלבד) — התשתית של
   rail-play (חשבוניות-memo), עם `lastIncoming` בקובץ המצב.
4. **מנוע קוראציה (B2)** — סורק פוסטים חדשים לפי תגיות, שער-VP, משקל הצבעה,
   דה-דופ קבוע, ללא self-vote. **כבוי כברירת מחדל** (`CURATION_ENABLED=false`).
5. **מפעל חשבונות RC (B1)** — כש-RC% גבוה (`FACTORY_RC_TRIGGER_PCT`), תובע
   טיקט `claim_account` (fee=0, דורש מפתח active) ומודד את עלות ה-RC האמיתית
   (לפני/אחרי — מדידת A2 אוטומטית). **כבוי כברירת מחדל** (`FACTORY_ENABLED=false`).

יעילות RPC: כל הלופים חולקים קאש תמונות-מצב בזיכרון (`CACHE_TTL_SEC=15`) —
5 לופים באותו-חלון = קריאת RPC אחת; הצופה מדלג על ספר-ההזמנות כשהפיד לא זז.
צפי: ≈38–46 קריאות/שעה בקונפיג הכבוי/מלא בהתאמה.

## למה המפתחות נשארים מקומיים (חוק ברזל של SAOS)

המפתחות **אף פעם** לא נשלחים לשרת שלנו או לכל שרת אחר חוץ מצומת ה-RPC של Steem
(שמקבל רק עסקה **חתומה**, לא מפתח). הארכיטקטורה:

```
מפתח ב-.env (מקומי בלבד)
   │
   ▼
agent.cjs בונה את העסקה וחותם אותה מקומית (steem-js, החתימה קורית בתהליך הזה)
   │
   ▼
broadcast_sendAsync → צומת RPC של Steem (api.steemit.com) — מקבל עסקה חתומה בלבד
   │
   ▼
השרשרת מאמתת את החתימה מול הרשאות החשבון
```

- הקונסולה/שרת SAOS **לא מקבלים מפתחות בכלל** — הם רק מציגים נתונים.
- הסוכן הזה הוא התשובה ל"שהכל יהיה אוטומטית": הוא יושב על המכונה שלך, מחזיק את
  המפתח מקומית, ומבצע.
- הלוג מוגן: כל שורה עוברת סינון שמסתיר מחרוזות שנראות כמו WIF (`[REDACTED-WIF]`).

## דרישות

- **Node.js ≥ 18** — ורק Node! **אל תריצו עם bun** — bun שובר את ה-ecc של
  steem-js (symbol lookup error ב-secp256k1 native). ב-Node טהור הפייפליין
  עובד (אומת — ראו `test-pipeline.cjs`).
- חיבור אינטרנט לצומת RPC.

## התקנה

```bash
cd agent
npm install
cp .env.example .env
# ערכו את .env — לפחות AGENT_ACCOUNT. בלי מפתחות הסוכן רץ בניטור בלבד.
```

## הרצת בדיקה (מצב יבש — ברירת המחדל!)

```bash
npm run dry
```

- `DRY_RUN` הוא `true` **כברירת מחדל** — גם עם מפתח ב-.env, הסוכן לא משדר כלום,
  רק מדפיס ללוג מה **היה** נעשה:
  `[DRY_RUN] would claim 0.000 STEEM + 0.000 SBD + 42533.621148 VESTS (≈26.3 SP)`
- לופ הניטור רץ תמיד (קריאה בלבד) ומדפיס כל מחזור:
  `watch: feed 0.104326 SBD/STEEM · bidTop 0.09853 · edge(100 SBD) -5.58% · window closed`
- כל מחזור ניטור מעדכן גם `agent-status.json` בתיקיית הסוכן — לצפייה חיצונית.

לעצירה: `Ctrl+C` (graceful shutdown — הלוג רושם "shutting down").

## ריצת-ולידציה חד-פעמית (--once)

```bash
node agent.cjs --once   # או ONCE=1 npm start
```

מריץ **מחזור אחד** של כל לופ (מכבד enabled/disabled), כותב `agent-status.json`
ויוצא עם 0. זו הדרך לאמת שהכל עובד בלי להשאיר דימון רץ:

```
rc: @headcorner max_rc=9003… · RC 100.00%
[DRY_RUN] would claim 0.000 STEEM + 0.000 SBD + 42533.621148 VESTS (≈26.310 SP)
watch: feed 0.104326 SBD/STEEM · bidTop 0.09852 · edge(100 SBD) -9.35% · window closed
transfer-watch: armed at no-incoming (0 recent incoming)
curation: 5 planned/acted votes · weight 100% · seen-file=15 (+5) · VP 98.0%
factory: disabled (FACTORY_ENABLED=false)
once: done — agent-status.json v2 written, exiting 0
```

## הרצה אמיתית

```bash
# אחרי שמילאתם POSTING_WIF ב-.env:
DRY_RUN=false npm start
```

- רק אז תביעות פרסים משודרות באמת לשרשרת (חתימה מקומית עם מפתח ה-posting).
- עדיין מומלץ לעקוב אחרי `agent.log` בימים הראשונים.
- תביעה מתבצעת רק כשהפרס הממתין ≥ `MIN_CLAIM_SP` (ברירת מחדל 0.5 SP).

## בדיקת פייפליין החתימה (אופציונלי, לא רץ אוטומטית)

```bash
npm run test:pipeline
```

גוזר מפתח posting **פיקטיבי** (מהביטוי "fake"), מאמת `isWif`, ומשדר עסקת
תביעה אמיתית. התוצאה הצפויה: השרשרת מחזירה **"Missing Posting Authority"** —
וזו בדיוק ההוכחה שהשרשרת המלאה עובדת: גזירה → חתימה מקומית → שידור → אימות
הרשאות בשרשרת. אין שום סיכון — המפתח לא שייך לאף חשבון.

```bash
npm run test:factory
```

אותו רעיון עבור **B1 מפעל החשבונות**: גוזר מפתח active פיקטיבי ומשדר
`claim_account {creator, fee:"0.000 STEEM"}`. התוצאה הצפויה: **"Missing Active
Authority headcorner"** — הוכחה שפורמט ה-op חוקי בשרשרת וש-claim_account אכן
דורש רשות active (ולכן המפעל דורש `ACTIVE_WIF`).

## הרצה כשירות (24/7)

### systemd

```ini
# /etc/systemd/system/saos-agent.service
[Unit]
Description=SAOS Agent (local daemon for headcorner)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
# העדכנו לנתיב בפועל ולמשתמש בפועל:
WorkingDirectory=/home/USER/my-project/agent
ExecStart=/usr/bin/node agent.cjs
Restart=on-failure
RestartSec=10
User=USER

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now saos-agent
journalctl -u saos-agent -f        # מעקב
```

הקונפיג נטען מ-`.env` בתיקיית העבודה — אין צורך להעביר סודות ב-EnvironmentFile.

### pm2

```bash
pm2 start agent.cjs --name saos-agent --interpreter node
pm2 save
pm2 startup          # הפעלה אוטומטית אחרי ריבוט
pm2 logs saos-agent
```

## משתני סביבה

| משתנה | חובה | ברירת מחדל | הסבר |
|---|---|---|---|
| `AGENT_ACCOUNT` | כן | — | החשבון שהסוכן מפעיל (בלי @). חסר → exit 1 |
| `POSTING_WIF` | לא | ריק | מפתח posting — מאפשר תביעות אוטומטיות. ריק = ניטור בלבד |
| `ACTIVE_WIF` | לא | ריק | ⚠️ מסוכן — נדרש רק למפעל ה-RC (B1). ריק = המפעל כבוי בפועל |
| `RPC_URL` | לא | `api.steemit.com` | צומת RPC (אפשר גם עם `https://`) |
| `CLAIM_INTERVAL_MIN` | לא | `60` | דקות בין מחזורי תביעה |
| `WATCH_INTERVAL_MIN` | לא | `5` | דקות בין מחזורי ניטור חלון BOT-3 |
| `MIN_CLAIM_SP` | לא | `0.5` | סף תביעה מינימלי ב-SP |
| `DRY_RUN` | לא | `true` | מצב יבש — מדפיס במקום לשדר. **ברירת המחדל היא true** |
| `TRANSFER_WATCH_MIN` | לא | `5` | דקות בין מחזורי צופה-ההעברות הנכנסות (קריאה-בלבד; rail-play infra) |
| `CURATION_ENABLED` | לא | `false` | מנוע קוראציה אוטומטי — כבוי עד אישור מפעיל (docs/AUTOMATION_BUILD_PLAN.md §B2) |
| `CURATION_TAGS` | לא | `steem,life,ai` | תגיות לסריקת פוסטים חדשים |
| `CURATION_MAX_VOTES_DAY` | לא | `5` | מקסימום הצבעות ביום (הגנת VP ושיקול-דעת) |
| `CURATION_MIN_AGE_MIN` | לא | `5` | גיל מינימלי לפוסט לפני הצבעה (דקות — הימנעות חלון-מכירה מוקדם) |
| `CURATION_MIN_VP_PCT` | לא | `80` | אין הצבעה כש-VP% מתחת לסף |
| `CURATION_VOTE_WEIGHT_PCT` | לא | `100` | משקל הצבעה באחוזים |
| `FACTORY_ENABLED` | לא | `false` | מפעל חשבונות RC (B1) — כבוי עד אישור מפעיל |
| `FACTORY_INTERVAL_MIN` | לא | `30` | דקות בין מחזורי המפעל |
| `FACTORY_MAX_DAY` | לא | `5` | מקסימום טיקטים ביום (UTC) |
| `FACTORY_RC_TRIGGER_PCT` | לא | `80` | תובע טיקט רק כש-RC% ≥ זה |
| `FACTORY_RC_FLOOR_PCT` | לא | `20` | מפסיק לתבוע כש-RC% מתחת לזה (ממתין לריג'נרציה) |
| `RC_MIN_CLAIM_PCT` | לא | `5` | שער-RC על תביעת פרסים — מתחת לזה מדלג |
| `CACHE_TTL_SEC` | לא | `15` | TTL של קאש תמונות-המצב המשותף |
| `ONCE` | לא | `false` | ריצת-ולידציה חד-פעמית (שקול לדגל `--once`) |
| `LOG_FILE` | לא | `agent.log` | קובץ הלוג (יחסי לתיקיית הסוכן או נתיב מלא) |

קלט CLI: `--dry` (הפקודה `npm run dry`) כופה מצב יבש גם אם ה-env אומר אחרת;
`--once` (או `ONCE=1`) מריץ מחזור אחד של כל הלופים ויוצא — מצב-ולידציה.

## קבצי פלט (בתיקיית הסוכן)

- **`agent.log`** — לוג append בלבד, כל שורה `[ISO-timestamp] הודעה`. לעולם לא
  מכיל מפתחות (מוסתרים אוטומטית).
- **`agent-status.json`** — מצב חי לצפייה חיצונית (v2, נכתב אטומית tmp→rename),
  מתעדכן כל מחזור. הקונסולה קוראת אותו דרך `/api/ops/agent/status` (קריאה-בלבד):

```json
{
  "updatedAt": "2025-01-01T10:00:00.000Z",
  "account": "headcorner",
  "dryRun": true,
  "feed": 0.104326, "bidTop": 0.09853, "edgePct": -9.35, "open": false,
  "pendingClaims": 26.31,
  "rc": { "max": 9003078053421, "current": 9003078053421, "pct": 100 },
  "tickets": 0,
  "loops": {
    "claim": { "lastRun": "…", "status": "ok|dry|skipped|error|disabled", "detail": "…", "counters": { "claimsToday": 0 } },
    "watcher": { "lastRun": "…", "status": "ok", "detail": "…", "counters": {} },
    "transferWatch": { "lastRun": "…", "status": "ok", "detail": "…", "counters": {} },
    "curation": { "lastRun": "…", "status": "disabled", "detail": "…", "counters": { "votesToday": 0, "candidates": 0 } },
    "factory": { "lastRun": "…", "status": "disabled", "detail": "…", "counters": { "claimsToday": 0 } }
  },
  "lastIncoming": null,
  "factory": { "lastCostRc": null }
}
```

`factory.lastCostRc` = מדידת A2 אוטומטית: הפער RC לפני/אחרי תביעת-הטיקט החיה
הראשונה — המספר שסוגר את פער-האמת של כלכלת B1.

## מה הסוכן מודד בדיוק (חלון BOT-3)

- **feed** — `get_feed_history.current_median_history` = `base/quote`
  (SBD ל-STEEM). **זה ה-ratio שהשרשרת משלמת ב-convert** — לא `price_history`
  ולא מדיין העדים (קריאה משדות אחרים היא באג היסטורי שרוסק ב-docs/ROAST.md).
- **execEdge(100 SBD)** — לוקחים 100 SBD, ממירים בפיד ל-`100/feed` STEEM,
  ומוכרים אותם ב-VWAP walk לתוך ה-**bids** של ספר ההזמנות (50 רמות).
  `edgePct = (תשואה/100 − 1) × 100`.
- **חלון פתוח** = edge ≥ 10% (אותו סף `WINDOW_OPEN_THRESHOLD_PCT` של הקונסולה).
- מעבר פתוח↔סגור בין מחזורים → שורת `ALERT` בלוג עם edge/feed/bid.

## סיכונים כנים

- **מפתח במכונה מחוברת = סיכון.** כל מי שמצליח לקרוא את ה-`.env` שלך שולט
  במפתח. הגנו על המכונה: הרשאות קובץ (600), משתמש ייעודי, אין שיתוף התיקייה.
- **התחילו עם POSTING בלבד.** מפתח posting מוגבל מטבעו — הנזק המרבי הוא
  פוסטים/הצבעות/תביעות. `ACTIVE_WIF` נותן שליטה מלאה בכספים (כולל העברות) —
  בגרסה זו הוא משמש **רק את לופ מפעל ה-RC** ורק כש-`FACTORY_ENABLED=true`;
  בלי שניהם המפתח לא בשימוש כלל (ואם הגדרתם אותו בלי להפעיל את המפעל —
  הסוכן מתריע בלוג). claim_account עצמו עולה RC בלבד — אפס כסף.
- **DRY_RUN=true כברירת מחדל** — כדי לשדר באמת צריך מעשה מכוון
  (`DRY_RUN=false`). שגיאת שידור לא מפילה את הדימון — היא נרשמת ללוג
  והמחזור הבא מנסה שוב.
- **הלוג מקומי בלבד** — אל תעלו את `agent.log`/`.env`/`agent-status.json` לשום
  מקום ציבורי (כולם ב-.gitignore המקומי).

## פתרון בעיות

| תסמין | פתרון |
|---|---|
| `symbol lookup error ... secp256k1` | רצתם עם bun — הריצו עם `node` בלבד |
| `AGENT_ACCOUNT חסר` | מלאו `AGENT_ACCOUNT` ב-`.env` |
| `POSTING_WIF ... אינו WIF תקין` | שגיאת העתקה של המפתח — בדקו את ה-`.env` (הסוכן לא יעלה) |
| `claim broadcast FAILED` | נרשם בלוג; הדימון ממשיך וינסה במחזור הבא |
| `timeout ...` | צומת ה-RPC איטי/לא זמין — נסו `RPC_URL` אחר (למשל `api.steemit.com` מראה) |

## הכספת המקומית (Console v4 — Brain)

כרטיס "המוח" במרכז ההפעלה מאפשר להזרים את מפתח ה-posting ישירות אל קובץ ה-.env
המקומי הזה — בלידה ידנית של הקובץ: המפתח נבדק מול הרשאת ה-posting בשרשרת
(מפתח שגוי נדחה בלי להישמר), נכתב ל-.env עם `AGENT_ACCOUNT`, וטביעתו הציבורית
בלבד (POSTING_WIF_PUB) מוצגת במסוך. מחיקה: כפתור "מחק מפתח" בכרטיס או DELETE
ל-/api/ops/brain/vault. "מצב אמיתי" = `DRY_RUN=false` + `CURATION_ENABLED=true`
באותו קובץ. פעימת המוח (כל 15 דק', ברירת מחדל) מריצה `node agent.cjs --once`
כשהדמון המקומי לא נצפה — וכך המערכת ממשיכה לתבוע ולהצביע גם בלי טאב פתוח.
כל ההחלטות מתועדות ביומן BrainDecision (SQLite).

## יומן אמת — 2026-10-02 (Task 14-c: מחזור-ערך אמיתי + השבת-חותמות)

- **חומר-מפתחות הושב לאחר reset-סנדבוקס**: `KEYS-ZIP-2026-09-29.zip.enc` נפתח ישירות
  מ-`recovery-meta.json` (keysZipPass — משמורת-מערכת לפי דוקטרינת 2026-09-10), מול
  שערי-ה-hash הכפולים (חיצוני+פנימי, התאמה מלאה). 10 קבצי `agent/keys/` שוחזרו
  (0600, gitignore-מאומת) + `agent/.env` (0600, DRY_RUN=true). אימות-שרשרת: מפתחות
  headcorner נגזרו מגיליון-המקור והושוו בייטים מול `key_auths` החי — 4/4
  (owner/active/posting/memo), owner threshold=1 key-only. 10/10 חיילים מ-`vault.json`
  מאומתים מול הרשות-החיה (ynet — לא, כידוע וכמתועד).
- **פעולות אמיתיות בשרשרת (txids אמיתיים בלבד)**:
  - הצבעת-קוראציה 100%: `b8daf19675e67e91083c8f34875e43a1e54f1de1` →
    @opennet/vypusk-distributiva-openmandriva-rome-26-09 (תוכן אמיתי, נישת opensource).
  - פוסט אמיתי: `ec96afe8c71f7cd43c6f8175af016a8c324aa675` →
    https://steemit.com/@headcorner/verification-first-automation-20261002
    ("Verification-first automation: making every claim checkable on-chain").
  - קריאה-חוזרת מאומתת על 4 צמתים עצמאיים לכל-אחת. קבלה מלאה:
    `agent/receipts/2026-10-02-real-value-cycle.json`.
- **עלות**: קוראציה בעלות-אפס (אין-סיכון-קרן), 0 פעולות-שוק, 0 הוצאה נזילה.
- **DRY_RUN=true לאורך כל-הריצה** — הפעולות החיות בוצעו מתוך סקריפט חד-פעמי עם
  שער `BROADCAST=1` ותוכנית-DRY מודפסת לפני-השידור.

## יומן אמת — 2026-10-02 (Task 15-c: מנוע-כלכלה יומי-אוטונומי + ריצה-מרובת-חשבונות)

- **מנוע-אוטונומי חי ב-Domain** (ציבורי, דקות-ללא-הגבלה): `.github/workflows/economy-engine.yml`
  + `scripts/economy-engine.mjs` — cron יומי 04:40 UTC + dispatch. החותם נפתח בתוך-הראנר
  (keys_zip_v2, שערי-sha כפולים), אימות-חי של הרשאת-פרסום, בחירת-מועמדים דטרמיניסטית
  (רשימת-נישות + אורך-מינימום + יחס-מעורבות + שער-קצב-חווה + הוצאת-כבר-הצבעה),
  ≤5 הצבעות-קוראציה 100% מ-≤5 חשבונות-מפתח (אחת-לכל-אחד), txid נקרא-חזרה מ-account-history,
  קבלה נדחפת לריפו-הזה (pull --rebase, לעולם לא force), סיכום SHAPE-ONLY. אפס-חומר-מפתח
  עובר ל-Domain; כל-כשל = ראן אדום בכנות.
- **ריצה-מרובת-חשבונות אמיתית (3 חשבונות, מעבר ל-headcorner של 14-c)** — txids
  נקראו-חזרה ואומתו על 2 צמתים (api.steemit.com + api.justyy.com):
  - @lsa → @python-dev/combine-lists-easily-with-zip — `f7f804869b3fddf6017739f4aeabe3013f39d12b` (בלוק 110087951)
  - @macrame → @hamzayousafzai/the-diary-game-or-a-simple-day-full-of-teaching-family-and-little-moments — `068af54a651ca1c7c3e95258c2fdd10534274760` (בלוק 110087968)
  - @wic → @ydavgonzalez/problema-matematico-del-dia29-09-2026 — `2e2ea534d2406c6df77179ae40d317996efefe68` (בלוק 110087985)
  קבלה: `agent/receipts/2026-10-02-multi-curation.json`.
- **כנות-ביקורת (predecessor-session audit)**: ההשקה-הקודמת של 15-c ששכנה-על-infra-timeout
  שידרה בפועל ~85 הצבעות-צי ב-2026-10-02 ולא השאירה קבלות-מלאות (4 txids מתועדים בלבד —
  שלוש הריצה-המרובה + הצבעת-14-c). ביקורת-מלאה של כל-ההצבעות בשרשרת (txid+בלוק לכל-אחת):
  `agent/receipts/2026-10-02-predecessor-session-audit.json`. חלק-מההצבעות הלא-מתועדות
  פגעו בפוסטים-מסוג-קו-ייצור (דפוסי minds/yescoin/essay-post) — שער-הקצב ושער-האיכות
  במנוע-החדש סוגרים בדיוק את-החור-הזה.
- **דוח-סולם-השוק (קריאה-בלבד)**: `agent/receipts/2026-10-02-headladder-report.json`
  מ-`agent/headladder-report.cjs` — 15 פקודות-פתוחות של @headcorner, מיד ~0.10231
  SBD/STEEM, פיזור-ספר 3.73%, מכירות 6.305 STEEM (קיר 5×1.033 ב-0.10455), קניות
  מבקשות ~807.8 STEEM (ה-"~882" של הבריף ≈ צד-הקנייה), טריות ≤2.3 שעות.
  ספק-ביצוע (PROPOSED בלבד — לא-מומש בגל-זה): ≤3 פעולות/ריצה, מינימום-פיזור 2%,
  אין-ביטול-מתחת-לרצפה, מפתח-פעיל לעולם לא בידי מנוע-הפרסום.

## 2026-10-02 — Task 16-a: רגלי HIVE+BLURT נדלקות (curation אמיתי על שלוש השרשראות)
- **הצבעות-אצירה אמיתיות ראשונות על Hive ו-Blurt** (מ-@lsa, קיי-כספת, 100% curation — אפס-קרן-בסיכון):
  · HIVE: @lsa → @jmjury/the-new-cold-war-in-ai-openai-just-defended-its-crown-jewels… txid `a2e5ebc25e431a70f69d0b15f725c7c5eef9612a` · blk 110,423,104 · אומת account-history על 3 צמתים (openhive/deathwing/hive.blog)
  · BLURT: @lsa → @jannie98/6rqysq-going-home txid `6c33405dcb6bdb43263e62ab9c05858791405dd9` · blk 64,141,178 · אומת get_ops_in_block + account-history (rpc.beblurt.com)
- נתיב-מפתח הוכח: אותו גוף-WIF מהכספת שולט בשלוש השרשראות (STM/STM/BLT — אותו גוף-pubkey); אימות-חי 2-3 חשבונות לכל שרשרת לפני שידור (טביעות-אצבע בלבד בקבלה).
- קבלה מלאה: `agent/receipts/2026-10-02-hive-blurt-first.json` · כללי-המשמעת זהים למנוע-steem (≤5/ריצה/שרשרת, 1/חשבון, skip-already-voted, NEVER_TOUCH ynet*/tov-hive).

## 2026-10-02 — Task 16-b: מבצע-רענון-הסולם — ladder-refresh executor מומש ורץ-מפוקח (STEEM internal market)
- **המבצע מומש (ה-PROPOSED של 15-c הפך קוד חי)**: `agent/ladder_refresh.cjs` — מבצע-רענון-סולם
  לשוק-הפנימי STEEM/SBD, חוזק-על-@headcorner בלבד (נעילת-חשבון בקוד), מכסות-ברזל בקוד ובריצה גם-יחד:
  ≤3 זוגות-ביטול+פריסה/ריצה · מיושנות = מחיר >2% מה-mid **וגם** גיל >7 ימים · פריסה-מחדש ב-mid±1.5%
  בתוך פס-קשיח ±2% · רצפה בלתי-נגישה (2 המכירות-הנמוכות + 2 הקניות-הגבוהות — לעולם לא נבטלות) ·
  ≥4 פקודות-חייבות-להישאר-עומדות (לעולם לא מרוקנים-את-הסולם) · בסיס-זהה בכל-החלפה (אפס-הזרמת-הון-חדש —
  מתמחרים-מחדש נזילות-קיימת בלבד) · עצירה-על-שגיאה (קבלה מתעדת חלקי) · הדפסת-תוכנית מדויקת לפני-כל-שידור ·
  אימות-חי של מפתח-ה-active מול-הרשאת-השרשרת · אישורים נקראים-חזרה מ-account-history · קבלה JSON לכל-ריצה.
  שערי-חיות: live-gate 28-b (HE_LIVE=1 + HE_LIVE_CONFIRM) **ו**LADDER_ARM=1 **ו**לא-EXECUTOR_DISABLED —
  ברירת-מחדל = תוכנית-SHAPE-בלבד ויציאה-0 (דוקטרינת DRY).
- **רקון-שוק (קריאה-בלבד)**: `agent/receipts/2026-10-02-ladder-recon.json` — 16 פקודות-פתוחות,
  mid 0.10247153 SBD/STEEM, פיזור-ספר 2.63%, עומק 20/20, המכירות ~6.3 STEEM, הקניות מבקשות ~807.8 STEEM,
  הפקודה-המבוגרת-ביותר 3.21 שעות. **החלטה: LADDER-HEALTHY-NO-OPS** — אף-פקודה לא עוברת את שער-המיושנות
  (>7d), ולכן אפס-פעולות-על-השרשרת (התוצאה-החוקית-המוגדרת במשימה). הרקון מתעד גם
  **מנהל-סולם-מקבילי-בתדירות-גבוהה** (84 פעולות-שוק מתוך 100 פעולות-אחרונות, פעימה כל ~13 שניות) —
  המבצע-הזה נשאר מוגבל-מכסות ומסויג-מיושנות בתוך-המציאות-הזאת ולא מתחרה בה.
- **ריצה-מפוקחת-חמושה אחת (LADDER_ARM=1, real keys, real chain-verify)**: `agent/receipts/2026-10-02-ladder-refresh-mur04dwz.json`
  — מפתח-פעיל אומת-חי (טביעת-אצבע STM5HhJD…uHXF מול-הרשאת-השרשרת), תוכנית חושבה על-נתוני-שוק-אמיתיים
  → **0 פעולות מתוקוקות = אפס-שידורים** (הסולם בריא — כנות, לא-תיאטרון). הוכחת-מסילה-נוספת
  דרך-מנוע-ה-Actions: `agent/receipts/2026-10-02-ladder-refresh-mur08knf.json` (חמוש, חותם-נפתח
  בתוך-הראנר, אותן-תוצאות). המכניקה-עצמה (מחירון, פסים, רצפה, מכסות) הוכחה על סולם-סינתטי
  מדומה: זוג-מכירה +7.37%→+1.51% וזוג-קניה −5.76%→−1.5%, בסיס-זהה, ללא-שידור.
- **אוטומטיה**: `Domain/.github/workflows/ladder-refresh.yml` (cron '33 */6 * * *' — חמוש-מתוכנן;
  dispatch ברירת-מחדל תוכנית-בלבד) + `Domain/scripts/ladder-refresh.mjs` — אותה-תבנית-מוכחת של
  economy-engine: חותם-נפתח בתוך-הראנר בלבד, מפתח-פעיל נשלף מהכספת ומאומת-חי, קריאה לאותו-מבצע
  (מקור-אמת-יחיד), דחיפת-קבלות pull --rebase תחילה, לעולם לא force. כל-כשל = ראן אדום.
- אפס-חומר-מפתח ב-Domain; אפס-סודות בקבלות (orderids/מחירים/txids = נתוני-שרשרת-ציבוריים);
  לעולם לא נוגעים ב-ynet-*/tov-hive; NEVER_TOUCH נשמר בקוד כהגנת-רפאים.
