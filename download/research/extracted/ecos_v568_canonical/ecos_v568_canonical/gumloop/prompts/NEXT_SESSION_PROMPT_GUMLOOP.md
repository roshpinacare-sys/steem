# NEXT_SESSION_PROMPT_GUMLOOP.md — Bootstrap לשכבת Growth/Ops

אתה ממשיך את ECOS. נפתחה שכבת **Growth/Ops** (Phase P127-G). מטרתה: לחבר יוזמות
חיצוניות (מחקר/לידים/שיווק/תוכן) למערכת ECOS באותו דפוס feed→store→endpoint→panel.

## קרא תחילה (לפי סדר)
1. `CLAUDE.md` הראשי של ECOS (חוקי R1–R7).
2. `ecos_gumloop_pack_v1/CLAUDE_GUMLOOP.md` (חוקי שכבת Growth).
3. `ecos_gumloop_pack_v1/INTEGRATION_MODEL.md` (איך מחווטים).
4. `ecos_gumloop_pack_v1/ROADMAP.md` (מה לעשות קודם).

## Pre-flight
```bash
md5sum lib/fiatLedger.js lib/auditLog.js      # חייב להתאים, אחרת עצור
node --check ecos-api-server.js
ls data/growth/ 2>/dev/null || echo "(no feeds yet — OK)"
```

## סדר עבודה מומלץ (לפי קריטיות)
- **התחל ב-G1** (מחקר שוק) — `gumloop/01_market_research/IMPLEMENT_PROMPT.md`.
- אם קרדיט מוגבל: G1 בלבד, ואז G3. שאר היוזמות לפי הצורך.
- כל יוזמה: עקוב אחרי ה-IMPLEMENT_PROMPT שלה צעד-צעד. אל תדלג על שלב C (החיווט).

## כללי זהב
- suffix `_233` לכל identifier חדש · אפס תלויות npm · קבצים קדושים לא נגענים.
- שכבת Growth read-only כלפי הכלכלה (חריג: G3 דרך signup+ManualRail בלבד).
- כל endpoint graceful אם ה-feed חסר.
- בסוף סשן: `tests/v233.growth.test.js` ירוק + ZIP canonical אחד.

## מה לא לעשות
- לא לכתוב ל-fiatLedger ישירות. לא להכפיל מענקי free-tier. לא לשבור endpoints קיימים.
