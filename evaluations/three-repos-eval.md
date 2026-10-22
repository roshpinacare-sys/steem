# הערכת שלושת המאגרים — W36 (trace 1a160da4b6e98e19)
נמדד: 2026-10-21T23:5xZ · שכפול רדוד · רישיון MIT ×3 · חוק: לא-לשכתב, לחלץ-הטוב

## 1. The-Swarm-Corporation/AutoHedge (★6,448, MIT)
- מה: קרן-גידור אוטונומית ב-Python/swarm. workers.py = 5 תפקידים: Sentiment → Quant-Analyst → Risk-Manager → Execution-Agent → Trading-Director. tools/ = registry למקורות-שוק (yahoo/polygon/jupiter/exa).
- שווה-חילוץ: הפרדת Risk-Manager כשער-חובה בין אנליזה לביצוע (התאמה ישירה ל-thinkGate של ה-custodian — החוק כבר קיים אצלנו, התבנית מחזקת) + tools_registry כתבנית למקורות-מחיר.
- לא-נבלע: ריצת LLM בכל החלטה (עלות/רעש), תלות swarms framework, אין רלוונטיות ל-STEEM internal market.

## 2. msitarzewski/agency-agents (★162,932, MIT)
- מה: ספריית תפקידי-סוכנים (277+ קבצי md לפי חטיבות: engineering/design/finance/...).
- שווה-חילוץ: תבניות-תפקידים לאיברי-המשרד (risk-officer ל-custodian, auditor-עצמאי ל-verifier). קבצי-md בלבד — אפס תלויות ריצה.
- לא-נבלע: כל הקטלוג (רובו לא-רלוונטי לריבונות שלנו); אין לוגיקת ריצה בכלל — זו ספריית-פרומפטים.

## 3. HKUDS/Vibe-Trading (★36,189, MIT)
- מה: פלטפורמת סוכן-מסחר אישית: agent/ (api_server, backtest/engines, evals, skills, mcp_server) + frontend + pixel-office + zimaos.
- שווה-חילוץ: מנוע ה-backtest (engines/constraints/correlation/benchmark) — לנו אין שכבת backtest לגריד; ה-tapes שלנו (db/tape.jsonl) יכולים להזין אותה. תבנית evals לתרגול-החלטות הגריד. SKILL.md כתבנית-ארגון.
- לא-נבלע: frontend/pixel-office/zimaos (עולם אחר), מסלולי binance (הרגל שלנו: STEEM/Hive בלבד).

## החלטות-אינטגרציה (סדר-עדיפויות)
1. grid-backtest organ (מ-Vibe-Trading engines, התאמה ל-tapes שלנו) — ערך אמיתי: אימות-פרמטרי-גריד לפני-חתימה. מאמץ: בינוני.
2. תבניות תפקידים (מ-agency-agents) ל-3 איברים: custodian/risk-officer, verifier/auditor, builder/proposal-writer. מאמץ: קטן.
3. tools_registry תבנית (מ-AutoHedge) למקורות-מחיר של ה-desk. מאמץ: קטן.
- כל-השאר: נדחה במפורש (רישום-כנות — לא הכל שווה, גם לא עם ★163k).
