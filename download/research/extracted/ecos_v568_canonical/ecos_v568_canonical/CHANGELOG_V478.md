# CHANGELOG_V478.md — V478

## מה זוהה
- `NEXT_SESSION_PROMPT_V477` הצביע על מגדל `meshDispatcher` (10 מודולים, V288–V297) עם שני canon ישנים: 470 + 474.
- Canon474 קיים אך חסר: ללא capId `stats`, ללא `search-by-decision`, health summary דל.

## מה נבנה
**`lib/meshDispatcherCanon478.js`** — facade מעודכן:
- `getCanonInfo478()` — metadata מלא כולל `supersedes: [canon470, canon474]`
- `getHealthSummary478()` — health snapshot עם towerLoaded, defaults, stats מכל שלוש המופעים
- `dispatchCapability478(capId, args)` — dispatch מורחב:
  - קיימים: `info`, `health`, `search`
  - חדשים: `stats` (combined feed+validator+gate), `search-by-decision`
  - fail-closed לכל capId לא-ידוע

## מה חובר
`meshDispatcherCanon478` → `meshDispatcher297` (tip) → D288..D296 (chain)
→ מחליף ומאחד canon470 + canon474

## Endpoints חדשים
- `GET  /api/v1/mesh-dispatcher/canon/status` (V478-T01)
- `POST /api/v1/mesh-dispatcher/canon/dispatch/v478` (V478-T02)
- `GET  /api/v1/admin/summary/v478` (V478-T03)

## אימות
- `version: 478.0.0` ✓
- `node --check ecos-api-server.js` ✓
- `tests/v478.test.js` → **12/12** ✓
- SACRED: `563e9b1f...` / `e5a5c2c2...` ✓
