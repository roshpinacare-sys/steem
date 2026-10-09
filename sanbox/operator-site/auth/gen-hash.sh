#!/usr/bin/env bash
# auth/gen-hash.sh — יצירת credentials.json מסיסמה במשתנה-סביבה (בלי לשמור את הסיסמה)
# שימוש: OPERATOR_BOOTSTRAP_PASSWORD='...' bash auth/gen-hash.sh
set -euo pipefail
: "${OPERATOR_BOOTSTRAP_PASSWORD:?הגדר OPERATOR_BOOTSTRAP_PASSWORD (לא מודפס, לא נשמר)}"
DIR="$(cd "$(dirname "$0")" && pwd)/../../state"
mkdir -p "$DIR"

OPERATOR_BOOTSTRAP_PASSWORD="$OPERATOR_BOOTSTRAP_PASSWORD" node -e '
const c = require("node:crypto");
const fs = require("node:fs");
const pw = process.env.OPERATOR_BOOTSTRAP_PASSWORD || "";
if (pw.length < 8) { console.error("FAIL: סיסמה קצרה (מינימום 8 תווים)"); process.exit(2); }
const salt = c.randomBytes(16);
const hash = c.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
const out = {
  version: 1,
  scrypt: { N: 16384, r: 8, p: 1, keylen: 64 },
  salt: salt.toString("hex"),
  hash: hash.toString("hex"),
  createdAt: new Date().toISOString()
};
fs.writeFileSync(process.argv[1], JSON.stringify(out, null, 2) + "\n", { mode: 0o600 });
console.log("OK: credentials.json נכתב (hash בלבד — הסיסמה לא נשמרה)");
' "$DIR/credentials.json"

chmod 600 "$DIR/credentials.json" 2>/dev/null || true
