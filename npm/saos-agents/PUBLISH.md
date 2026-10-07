# PUBLISH — checklist (ריבונות)

## מצב (2026-10-07)
- השם `saos-agents` **פנוי** ב-registry (probe: HTTP 404)
- בארגז-זה **אין-טוקן-npm** (npm whoami → ENEEDAUTH) — הפרסום-עצמו דורש-טוקן-מהמפעיל

## פרסום — פקודות-בפעם-הראשונה
1. צור-טוקן-פרסום (publish-only, granular): npmjs.com → Access Tokens → Generate
2. `npm config set //registry.npmjs.org/:_authToken <TOKEN>`  (או `NPM_CONFIG__AUTH` בסביבה)
3. `cd npm/saos-agents && npm pack` → בדוק-תוכן-ה-tarball
4. `npm publish --access public`
5. אימות-חי: `npm view saos-agents version` → 0.1.0 · `npx saos-agents doctor` → healthy=true

## חוקים
- אפס-סודות-בחבילה (npm pack ואז-בדיקה-לפני-publish; files-allowlist-ב-package.json)
- סמנטיקה: 0.x = עדיין-בשלב-אמון-נבנה; breaking → 1.0.0-רק-אחרי-npx-מאומת-בכמה-סוכנים
- אחרי-פרסום: לרשום-מהדורה-ב-docs/measured (קצב-הפלטה — חוק-חמישי)

## עדכון-ריבוני (2026-10-07 ~19:50Z)
- GitHub-Packages: probe-read=**404** (אותנטיקציה-תקינה-מוכחת) → publish=**E403** `permission_denied: token does not match expected scopes` — ה-PAT-fine-grained חסר **packages:write**. פעולת-מפעיל-אחת: הוספת-hasar-זה (או-classic write:packages) ואז `npm publish` עובד-בעסקה-אחת (`.npmrc`-מוכן-בארגז, `${NODE_AUTH_TOKEN}`-בלבד, אפס-סודות-בגיט)
- **נתיב-שכבר-בוצע-בחיים**: GitHub-Release `saos-agents-v0.1.0` (id 406106235) + asset tarball 17,199B state=uploaded — ההפצה-המגורסת-הראשונה; קצב-המהדורות נפתח (חוק-חמישי)
- npmjs.org: שם-`saos-agents`-פנוי (404) — ממתין-טוקן-npmjs-מהמפעיל; לאז: החזר-שם-ללא-scope-ב-package.json

## עדכון R250 — פסק-הדין הנמדד (E403 ×3)
- ניסיון-שלישי ואחרון עם ה-PAT-המורחב-על-ידי-המפעיל: **E403** @ 2026-10-07T20:27:53Z —
  `permission_denied: The token provided does not match expected scopes`.
- **שורש-האמת**: הטוקן fine-grained (`github_pat_`, 93B) והחשבון `roshpinacare-sys` הוא
  **User** (GET /user: type=User) — בממשק-fine-grained אין הרשאת-Packages על חשבון-אישי
  (היא קיימת רק תחת Organization permissions) ⇒ **בלתי-אפשרי** להשלים בנתיב הזה, לא חסר
  לחיצה-כלשהי.
- **הנתיב-היחיד**: classic PAT + סקוב `write:packages` → הוראות-מדויקות למפעיל:
  **`docs/OPERATOR-PAT-STEPS.md`** → אחר-כך `bash scripts/publish-github-packages.sh`
  (הסקריפט מסרב טוקן-fine-grained, בודק-תקינות-חבילה, מפרסם, ומאמת-חי).
- pat-audit חי: `bun scripts/pat-audit.mjs` — verdict JSON (סוג-טוקן, identity, rate,
  leak-scan של ערך-הטוקן מול העץ, ו-capability).
