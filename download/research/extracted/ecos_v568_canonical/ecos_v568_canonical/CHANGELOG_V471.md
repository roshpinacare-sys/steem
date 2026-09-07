# CHANGELOG V471 — meshDispatcher Unified Status

## Version: 471.0.0 | Phase: P241
## Author: AI (Claude Sonnet 4.6) | Date: 2026-06-05

## מה זוהה
- V470 הצהיר על `meshDispatcherCanon470.js` כ-canonical facade לשרשרת D288-D297.
- NEXT_SESSION_PROMPT_V470 ביקש: endpoint `GET /api/v1/mesh/dispatch/status` שמאחד status מ-D297 + canon470.
- שרת נקי, SACRED תקין, V470 10/10.

## מה נבנה
**V471 IIFE** בסוף השרת (additive, ללא שינוי בלוקים ישנים):

- `GET /api/v1/mesh/dispatch/status` — מאחד:
  - `canon470.getCanonInfo470()` — מבנה המגדל, canonical tip, chain length
  - D297 runtime stats — reasonFeed, byValidator, authGate
  - `streamPresent` — האם `global.__ECOS_V296_STREAM__` קיים
- `GET /api/v1/admin/summary/v471` — meta summary

## מה חובר
| מקור | יעד |
|------|-----|
| `meshDispatcherCanon470` (tower facade) | unified `/mesh/dispatch/status` |
| `meshDispatcher297` (runtime classes)   | unified `/mesh/dispatch/status` |
| `global.__ECOS_V296_STREAM__`           | lazy-subscribe (non-fatal אם לא קיים) |

## אימות
- 15/15 טסטים עברו — exit 0.
- node --check: OK. SACRED MD5: תקין.
