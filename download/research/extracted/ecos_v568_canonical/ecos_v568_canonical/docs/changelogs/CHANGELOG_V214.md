# CHANGELOG — ECOS V214 (Phase P103)

**Date:** 2026-05-31
**Version:** 214.0.0 (→ from 213.0.0)
**Phase:** P103
**Research sources:** RESEARCH_PROMPT_ECOS_V2.md + live Anthropic web-search tool

---

## What changed

### New files

| File | Purpose |
|------|---------|
| `src/research/researchTool214.jsx` | כלי מחקר אינטראקטיבי — מריץ RESEARCH_PROMPT_ECOS_V2 נגד Claude Sonnet + web_search לפני כל גרסה |

### Files NOT modified (R1 sacred rule)

- `lib/fiatLedger.js` ✅ MD5 unchanged: 563e9b1f9e67091a5b6527c0a92568e5
- `lib/auditLog.js` ✅ MD5 unchanged: e5a5c2c27801d2d03991bc8e5a1df8cb

---

## Research Tool — תיאור ומטרה

### הבעיה שנפתרה

עד V213 המחקר בוצע ידנית (העלאת PDFים → Claude מנתח → בונה). התהליך לא היה
שקוף, לא חוזר, ולא מחובר לפרוטוקול הגרסאות.

### הפתרון — `researchTool214.jsx`

כלי React שרץ **לפני תחילת כל גרסה חדשה** (V215, V216, ...):

1. **מריץ** את `RESEARCH_PROMPT_ECOS_V2` נגד `claude-sonnet-4-20250514` עם כלי `web_search_20250305`.
2. **מקבל** JSON מובנה עם: לקחים, מקרי בוחן 2024–2026, נקודות עיוורון, דגלים אדומים, מהלכי V214–V218.
3. **מציג** בממשק terminal-style (RTL עברית) עם 7 טאבים: Overview / מקרי בוחן / פסיכולוגיה / אסטרטגיה / עיוורון / לקחים / דגלים אדומים.
4. **מאפשר** לבעל המוצר לסנן, לקרוא, ולהחליט אילו לקחים להחדיר לגרסה הבאה.

### שילוב בזרימת עבודה

```
פתח researchTool214.jsx (claude.ai Artifacts / local dev)
  ↓
לחץ "הרץ מחקר מעמיק"
  ↓
Claude Sonnet + web_search מחזיר JSON (30–60 שניות)
  ↓
סקור tabs: Overview → section_b → blind_spots → red_flags
  ↓
העתק moves_v21x הרלוונטיים → NEXT_SESSION_PROMPT_V21x.md
  ↓
פתח session חדש עם הפרומפט המעודכן
```

### תאימות לכלים שבשימוש

| כלי | תפקיד |
|-----|--------|
| `claude.ai Artifacts` | הרצת JSX ישירות — אין צורך בסביבה מקומית |
| `Anthropic API /v1/messages` | הנחדר ל-Artifact, מפעיל web_search |
| `claude-sonnet-4-20250514` | המודל — אחיד עם שאר המערכת (R3 spirit) |
| `web_search_20250305` | tool שמביא נתונים 2024–2026 בזמן אמת |

---

## Strategic direction V214 (מה המחקר מכוון לבנות)

על פי NEXT_SESSION_PROMPT_V213:

1. **Wire Economic Safety Monitor לנתונים חיים** — `assess213` → `/admin/health/economy` עם snapshots.
2. **Decay enforcement** — reputation decay → voting weight + royalty share בפועל (לא רק דיווח).
3. **Stablecoin-only payout guard** — executor/connector payouts = external-stable בלבד.
4. **Sybil gate** — דרישת verified social link לפני tasks בעלות ערך כספי.

---

## Invariants

- R1 sacred files immutable
- R2 all V214 identifiers suffixed `...214`
- R3 zero new npm dependencies (web_search הוא Anthropic API tool, לא npm package)
- R4 test exports in single `NODE_ENV=test` block
- R5 version 214.0.0 in package.json
