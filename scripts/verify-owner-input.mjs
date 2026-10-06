/* ─────────────────────────────────────────────────────────────────────
 * THE WEAVE · verify-owner-input — בדיקת ערך שהועלה נגד הרשויות החיות
 *
 * דוקטרינה: אפס סוד מודפס אי-פעם — רק טביעות-אצבע (4 תווים ראשונים)
 * ופסקי-דין. הערך נקרא מ-upload/, לא נשמר לשום מקום אחר.
 *
 * בודק: (א) WIF כמו-שהוא (ב) WIF בלי תו מוביל (ג) סיסמת-אב × 4 תפקידים
 * מול הרשויות החיות של @headcorner ב-Steem (נקראו כעת מהשרשרת).
 * ───────────────────────────────────────────────────────────────────── */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const GC = require(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "console", "gate-crypto.js"));

// usage: node scripts/verify-owner-input.mjs [file]
// default: upload/headcorner.txt (the operator's delivered file, sandbox-only)
const FILE = process.argv[2] || "upload/headcorner.txt";

const ACCOUNT = "headcorner";

// רשויות חיות — נמדדו מ-api.steemit.com ברגע הרצה זה (קריאה חסרת-מפתחות)
const LIVE = {
  owner: "STM5aUKyd9LzENnMti5tS478Zu1SLJW51VHyu2gvSNGKhwfyMFpvv",
  active: "STM5HhJD5WUXu8vPhDmLaC2fTuuJYkwxF62Rt17HZ5G2PbnBvuHXF",
  posting: "STM8m3rBLd8CA2KkY764fkFBnYGoCaK1ktDjn825HUbq25i52N9cw",
  memo: "STM7mBK98NCE3HfMhqB9ADdxTutE1RSyGzpJQ6xiybr7gbmpQcXM9",
};

const raw = readFileSync(FILE, "utf8");
const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
if (lines.length < 2) {
  console.error("usage: expected account + credential lines");
  process.exit(1);
}
const fileAccount = lines[0];
const value = lines[lines.length - 1];

console.log(`[i] file account field: ${fileAccount}`);
console.log(`[i] credential length: ${value.length} chars, fingerprint: ${value.slice(0, 4)}…`);

const findMatch = (pub) => Object.entries(LIVE).find(([, p]) => p === pub);

const variants = [
  { name: "as-is", v: value },
  { name: "strip-leading-char", v: value.slice(1) },
];

let matched = null;

for (const { name, v } of variants) {
  // (א) כ-WIF
  try {
    const priv = await GC.wifToPriv(v);
    const pub = await GC.pubToSTM(GC.privToPubBytes(priv));
    const m = findMatch(pub);
    console.log(`[${name} · WIF]     pub=${pub.slice(0, 12)}… → ${m ? "MATCH:" + m[0] : "no-match"}`);
    if (m && !matched) matched = { kind: "wif", variant: name, role: m[0], wif: v };
  } catch (e) {
    console.log(`[${name} · WIF]     not-a-WIF (${e.message})`);
  }
  // (ב) כסיסמת-אב × 4 תפקידים
  for (const role of ["owner", "active", "posting", "memo"]) {
    try {
      const wif = await GC.masterToWif(ACCOUNT, role, v);
      const priv = await GC.wifToPriv(wif);
      const pub = await GC.pubToSTM(GC.privToPubBytes(priv));
      const m = findMatch(pub);
      console.log(`[${name} · master/${role.padEnd(7)}] pub=${pub.slice(0, 12)}… → ${m ? "MATCH:" + m[0] : "no-match"}`);
      if (m && !matched) matched = { kind: "master", variant: name, role, wif };
    } catch (e) {
      console.log(`[${name} · master/${role}] error: ${e.message}`);
    }
  }
}

console.log("──────────────────────────────");
if (matched) {
  console.log(
    `VERDICT: ${matched.kind === "wif" ? "WIF" : "master-password"} ${matched.variant} matches LIVE ${matched.role.toUpperCase()} authority of @${ACCOUNT}`
  );
  // טביעת-אצבע בלבד של ה-WIF הנגזר — לעולם לא הערך
  console.log(`derived WIF fingerprint: ${matched.wif.slice(0, 6)}… (len ${matched.wif.length})`);
} else {
  console.log("VERDICT: NO MATCH against any live authority of @" + ACCOUNT);
}
