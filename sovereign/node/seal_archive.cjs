#!/usr/bin/env node
/**
 * 117p5 — SEAL · חותם-הארכיון-הריבוני
 *
 * בעיה: chain-archive.jsonl צומח ~1.8MB/30דק → gitkeeper היה מצמיד בלוב-חדש-מלא
 * בכל-סבב → .git מתנפח ~86MB/יום. הפתרון: הקובץ-החי נשאר מקומי-בלבד (gitignored),
 * והישרדות עוברת לחותם-דחוס שנעקב: chain-archive-seal.jsonl.gz (~10MB).
 *
 * חוקי-החותם (survival-first, תיקון-117i-רוח):
 *   1. ארכיון-חי חסר + חותם-קיים  → שחזור-מיידי מהחותם (אף-קורא-לא-נשבר)
 *   2. צמיחה > SEAL_GROWTH או גיל > SEAL_AGE_H שעות → חותם-חדש (gzip -1, ~0.5s)
 *   3. אחרת → no-op. אפס-כתיבה מיותרת.
 *
 * הקריאה: gitkeeper מריץ את זה כל-סבב (לפני add -A). גם ידני: node seal_archive.cjs
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const NODE = __dirname;
const ARCHIVE = path.join(NODE, "chain-archive.jsonl");
const SEAL = path.join(NODE, "chain-archive-seal.jsonl.gz");
const SEAL_STATE = path.join(NODE, "chain-archive-seal-state.json");

const SEAL_GROWTH = 128 * 1024 * 1024; // צמיחה-מצטברת-מאז-החותם-הקודם
const SEAL_AGE_H = 20;                 // גיל-מרבי-בשעות

function sh(cmd, opts) {
  return execSync(cmd, { cwd: NODE, stdio: ["ignore", "pipe", "pipe"], timeout: 120_000, ...opts });
}
const sha256 = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

function loadState() {
  try { return JSON.parse(fs.readFileSync(SEAL_STATE, "utf8")); } catch { return null; }
}
function saveState(s) {
  fs.writeFileSync(SEAL_STATE, JSON.stringify(s, null, 2) + "\n");
}

function restoreFromSeal() {
  sh(`gzip -dc ${JSON.stringify(SEAL)} > ${JSON.stringify(ARCHIVE)}`);
  const s = loadState() || {};
  s.restoredAt = new Date().toISOString();
  s.archiveBytes = fs.statSync(ARCHIVE).size;
  saveState(s);
  console.log(`SEAL-RESTORE · archive restored from seal (${Math.round(s.archiveBytes / 1048576)}MB)`);
}

function makeSeal(prev) {
  sh(`gzip -1 -c ${JSON.stringify(ARCHIVE)} > ${JSON.stringify(SEAL + ".tmp")}`);
  fs.renameSync(SEAL + ".tmp", SEAL);
  const st = {
    at: new Date().toISOString(),
    archiveBytes: fs.statSync(ARCHIVE).size,
    archiveSha256: sha256(ARCHIVE),
    sealBytes: fs.statSync(SEAL).size,
    sealSha256: sha256(SEAL),
  };
  saveState(st);
  console.log(`SEAL-MADE · archive=${Math.round(st.archiveBytes / 1048576)}MB → seal=${(st.sealBytes / 1048576).toFixed(1)}MB · ${st.sealSha256.slice(0, 12)}…`);
}

function main() {
  // 1) שחזור: הארכיון-החי נעלם/ריק (wipe/reset) והחותם-קיים → החיים-קודם
  const archiveExists = fs.existsSync(ARCHIVE);
  const archiveBytes = archiveExists ? fs.statSync(ARCHIVE).size : 0;
  if ((!archiveExists || archiveBytes === 0) && fs.existsSync(SEAL)) {
    restoreFromSeal();
    return;
  }
  if (!archiveExists) {
    console.error("SEAL-ABORT · אין-ארכיון-ואין-חותם — אין-מה-להחזיר (זעקה-מוצדקת)");
    return;
  }

  // 2) חותם-ראשון או הגיע-הזמן
  const prev = loadState();
  const sinceBytes = prev ? archiveBytes - (prev.archiveBytes || 0) : Infinity;
  const ageH = prev?.at ? (Date.now() - Date.parse(prev.at)) / 3600_000 : Infinity;
  const needs = !fs.existsSync(SEAL) || !prev || sinceBytes > SEAL_GROWTH || ageH > SEAL_AGE_H;
  if (needs) makeSeal(prev);
  else console.log(`SEAL-SKIP · since=${(sinceBytes / 1048576).toFixed(1)}MB age=${ageH.toFixed(1)}h (בסף: ${SEAL_GROWTH / 1048576}MB / ${SEAL_AGE_H}h)`);
}

try { main(); } catch (e) {
  console.error("SEAL-FAIL · " + String((e && e.message) || e).slice(0, 160));
  process.exitCode = 1;
}
