#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// vault-read — קורא-הכספת הריבוני לסוכנים (r180 · D-OP-01)
//
// הוראת הבעלים המכוננת: "יש לך את כל הסיסמאות שלי תפעיל הכל מיד" +
// "אטום הכל בכספת לסוכנים שיוכלו להשתמש תמיד". הכספת קיימת מעתה ב-
// ~/.sovereign/vault/secrets/ (0600) והקורא הזה הוא הדלת היחידה אליה.
//
// שימוש:
//   bun console/agents/vault-read.mjs --list
//       רשימת שמות בלבד — אפס סודות בפלט.
//   bun console/agents/vault-read.mjs <NAME>
//       ערך הסוד ל-stdout (ל-piping: WEAVE_STEEM_WIF=$(vault-read …)).
//   bun console/agents/vault-read.mjs --manifest
//       מניפסט מלא: מקורות, תאריכים, מפת הכספות — בלי ערכים.
//
// חוקי-ברזל:
//   · הערך עולה ל-stdout בלבד — לעולם לא ללוג, לא לגיט, לא לתשובת-API.
//   · לפני שידור על-שרשרת — חובה אימות מול הרשות החיה (השרשרת השופט).
//   · כל שימוש בסוד נרשם ל-~/.sovereign/vault/access.log (שם-סוד + זמן
//     בלבד — אף ערך לא נרשם).
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const VAULT = path.join(os.homedir(), ".sovereign", "vault");
const SECRETS = path.join(VAULT, "secrets");
const ACCESS_LOG = path.join(VAULT, "access.log");

function list() {
  if (!fs.existsSync(SECRETS)) return [];
  return fs.readdirSync(SECRETS).filter((f) => !f.startsWith(".")).sort();
}

function read(name) {
  const safe = name.replace(/[^A-Za-z0-9_-]/g, "");
  const p = path.join(SECRETS, safe);
  if (!fs.existsSync(p)) return null;
  try {
    fs.appendFileSync(ACCESS_LOG, `${new Date().toISOString()} read ${safe}\n`, { mode: 0o600 });
  } catch {
    /* log failure never blocks a read */
  }
  return fs.readFileSync(p, "utf8").trim();
}

const arg = process.argv[2];

if (arg === "--list") {
  const names = list();
  console.log(names.map((n) => `${n} (${fs.statSync(path.join(SECRETS, n)).size} bytes)`).join("\n"));
  console.log(`\n${names.length} keys sealed · vault: ${VAULT}`);
  process.exit(0);
}

if (arg === "--manifest") {
  const manifest = JSON.parse(fs.readFileSync(path.join(VAULT, "MANIFEST.json"), "utf8"));
  console.log(JSON.stringify(manifest, null, 1));
  process.exit(0);
}

if (!arg) {
  console.log("vault-read — הקורא הריבוני (r180)\nשימוש: vault-read <NAME> | --list | --manifest");
  process.exit(1);
}

const val = read(arg);
if (val === null) {
  console.error(`vault-read: הסוד '${arg}' לא נמצא בכספת (--list לרשימה)`);
  process.exit(2);
}
process.stdout.write(val);
