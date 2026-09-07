# NEXT SESSION PROMPT V483 → V484

## מצב ב-V483
- 483.0.0. `providerAdapters275Canon483.js` פועל כ-delegation shim.
- V276 מייבא מ-275Canon483 (לא מ-275 ישירות).
- SACRED intact. 10/10 ירוקים.

## הצעד הבא הכי בעל-מינוף

**המשך pattern ה-shim לנקודות הבאות בשרשרת:**

בדוק אם V277 מייבא V276 ישירות:
```bash
grep "require.*providerAdapters276" lib/providerAdapters277.js
```
אם כן — צור `providerAdapters276Canon484.js` (delegation shim זהה לתבנית 483),
ועדכן את V277 לייבא ממנו.

**תבנית ה-shim קבועה** (העתק והתאם):
```js
const _base = require('./providerAdapters276.js');
module.exports = { ..._base, getCanonInfo484() { return { version: '484.0.0', ... }; } };
```

**כלל קשיח**: אל תיגע ב-268/269/273 (ACTIVE_PATCH) ואל תיגע ב-SACRED.
node --check + SACRED md5 + exit 0 לפני אריזה.
