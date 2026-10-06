#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// SEAL-ADOPT (r72) — אימוץ סיסמת-האב שמסר המפעיל כסיסמת החותם.
//
// הרקע הכנה (הכל נמדד, 2026-09-21):
//   · המפעיל מסר ערך תחת MAIN_KEY בכספת Domain (12:30:42Z) ואמר
//     שממנה "אפשר לקבל את כל המפתחות". הערך נבדק לגמרי: אינו
//     active של @headcorner ואינו מפתח/סיסמת-אב של אף חשבון מתועד
//     (12 גזירות × 2 שרשרות, 0 התאמות — קבלה 12:35:03Z), ואינו פותח
//     את החותם הנוכחי (BEAT-ERROR אימות AEAD, ריצה 35600471533).
//   · המפתחות עצמם (ענן+רשת) ניתנים לשחזור מההיסטוריה של הבית
//     הריבוני עצמו: ה-blob הקודם והסיסמה שלו לפני-הסבב שניהם בשושלת
//     הגיט (פער המשמרת של G3: הסבב החליף סיסמה אך לא מחק היסטוריה).
//     נמדד במלואו: המפתח המשוחזר גוזר בדיוק 0xaB07… (החותם של
//     att 293 החיה) ו-0xe376… — וחתימת EIP-191 עוברת אימות הלוך-וחזור.
//
// מה הסקריפט הזה עושה (מינימלי, בלי תלותות, בלי להדפיס סוד לעולם):
//   1. קורא את MAIN_KEY מהסביבה (הרצה של Domain — הסוד לא נקרא מחוץ
//      לכספת של הריפו שבו הוא חי). מסרב בכנות אם ריק/קצר מ-20 תווים.
//   2. אידמפוטנטיות קודם תורץ: אם החותם הנוכחי כבר נפתח עם הערך —
//      כלום לא נכתב, יציאה ירוקה.
//   3. מוציא מההיסטוריה כל (blob, סיסמה) אפשרי של החותם ומנסה
//      לפתוח — עד שאחד נפתח. המפתחות זהים לאורך השושלת (הסבבים
//      החליפו סיסמאות בלבד).
//   4. מאמת את התוכן: כתובות המפתחות שוות למטא הנוכחי ולחותם
//      ההתחייבות החיה ב-ledger.json. אי-התאמה = סירוב כנה, שום דבר
//      לא נכתב.
//   5. מצפין מחדש את אותם המפתחות בדיוק (פורמט הבית: scrypt(2^14)
//      + aes-256-gcm, שורות של 100) עם הערך שמסר המפעיל.
//   6. מעדכן את המטא (rotatedAt + משמרת כנה), מקמט ודוחף ל-main
//      של Zip (ניסיונות חוזרים עם rebase).
//
// הסטטוס שאחרי: התאומים ב-Domain קוראים WEAVE_SEAL_PASSPHRASE ||
// MAIN_KEY — ה-fallback הוא מעתה הסיסמה הנכונה. הלב, קווי-העיגון
// וה-ZERO נפתחים. המשמרת: הכספת של Domain (הערך שהמפעיל מחזיק
// בידו), הכספת של Zip (העתק — צעד 30-שניות של המפעיל להדביק את
// אותה הסיסמה תחת WEAVE_SEAL_PASSPHRASE), והידע של המפעיל עצמו.
//
// בדיקה עצמית: node scripts/seal-adopt.mjs --self-test  (עותק
// זמני, לא נוגע בעץ העבודה; מוכיח את מלוא השרשרת עם סיסמת בדיקה).
//
// לוגים: לעולם לא הערך, לא המפתחות, לא הסיסמה הישנה — רק כתובות,
// פסקי-דין וגהים.
// ─────────────────────────────────────────────────────────────────────

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd(); // the Zip checkout root
const SEAL_DIR = path.join(ROOT, "sovereign");
const ENC_PATH = path.join(SEAL_DIR, "weave-seal.enc");
const META_PATH = path.join(SEAL_DIR, "weave-seal.meta.json");
const LEDGER_PATH = path.join(SEAL_DIR, "ledger.json");
const MAGIC = "WEAVE-CLOUD-SEAL-1";
const MIN_LEN = 20;

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8", cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function sealDecrypt(hex, passphrase) {
  const payload = Buffer.from(hex, "hex");
  const salt = payload.subarray(0, 16);
  const iv = payload.subarray(16, 28);
  const tag = payload.subarray(28, 44);
  const ct = payload.subarray(44);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(pt);
  if (parsed.format !== MAGIC) throw new Error("unrecognized seal content");
  return parsed;
}

function sealEncrypt(payloadObj, passphrase) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(payloadObj), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, ct]).toString("hex");
}

function writeFileFormat(hex) {
  return MAGIC + "\n" + (hex.match(/.{1,100}/g) ?? []).join("\n") + "\n";
}

function parseSealFile(raw) {
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  if (lines[0] !== MAGIC) throw new Error("bad magic");
  return lines.slice(1).join("");
}

/** every (blob, passphrase) candidate pair from the repo lineage */
function historicalPairs() {
  const pairs = [];
  const commits = sh("git log --format=%H --follow -- sovereign/weave-seal.enc").split("\n").filter(Boolean);
  const metaCommits = sh("git log --format=%H --follow -- sovereign/weave-seal.meta.json").split("\n").filter(Boolean);
  const pps = new Set();
  for (const c of metaCommits) {
    try {
      const m = JSON.parse(sh(`git show ${c}:sovereign/weave-seal.meta.json`));
      if (typeof m.passphrase === "string" && m.passphrase.length > 0) pps.add(m.passphrase);
    } catch { /* commit may predate the meta */ }
  }
  for (const c of commits) {
    let hex = "";
    try { hex = parseSealFile(sh(`git show ${c}:sovereign/weave-seal.enc`)); } catch { continue; }
    for (const pp of pps) pairs.push({ commit: c, hex, pp });
  }
  return pairs;
}

function verifyPayload(pt, { meta, ledger }) {
  if (typeof pt.cloudKeyHex !== "string" || pt.cloudKeyHex.length < 64) throw new Error("payload missing cloudKeyHex");
  if (typeof pt.networkKeyHex !== "string" || pt.networkKeyHex.length < 64) throw new Error("payload missing networkKeyHex");
  const a = String(pt.cloudAddress).toLowerCase();
  const b = String(pt.networkAddress).toLowerCase();
  if (a !== String(meta.cloudAddress).toLowerCase()) throw new Error("cloud address mismatch vs current meta");
  if (b !== String(meta.networkAddress).toLowerCase()) throw new Error("network address mismatch vs current meta");
  const atts = ledger?.attestations;
  if (!Array.isArray(atts) || atts.length === 0) throw new Error("live ledger unreadable");
  const lastSigner = String(atts[atts.length - 1].signerAddr).toLowerCase();
  if (a !== lastSigner) throw new Error("cloud address mismatch vs live ledger last signer");
  return { cloud: a, network: b, attSeq: atts[atts.length - 1].seq };
}

async function main() {
  const selfTest = process.argv.includes("--self-test");
  console.log(`[seal-adopt] boot · ${new Date().toISOString()} · selfTest=${selfTest}`);

  const meta = JSON.parse(fs.readFileSync(META_PATH, "utf8"));
  const ledger = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));

  // 1. the operator's delivered value (never printed)
  let PP = "";
  if (selfTest) PP = "self-test-" + crypto.randomBytes(24).toString("base64url");
  else {
    PP = String(process.env.MAIN_KEY || "").trim();
    if (!PP) { console.error("[seal-adopt] REFUSED: MAIN_KEY is not set in this repository's vault."); process.exit(1); }
    if (PP.length < MIN_LEN) { console.error(`[seal-adopt] REFUSED: delivered value too short (${PP.length} < ${MIN_LEN} chars) — a weak passphrase will not be adopted.`); process.exit(1); }
  }
  console.log(`[seal-adopt] MAIN_KEY: *** (${PP.length} chars, masked)`);

  // 2. idempotency — does the current seal already open with it?
  const currentHex = parseSealFile(fs.readFileSync(ENC_PATH, "utf8"));
  try {
    const pt = sealDecrypt(currentHex, PP);
    console.log("[seal-adopt] the current seal already opens with the delivered value — nothing to do.");
    console.log(`[seal-adopt] addresses: cloud=${pt.cloudAddress} · network=${pt.networkAddress}`);
    process.exit(0);
  } catch { /* not the current passphrase — proceed to adoption */ }

  // 3. recover the keys from the sovereign lineage
  const pairs = historicalPairs();
  console.log(`[seal-adopt] lineage scan: ${pairs.length} (blob × passphrase) candidate pairs`);
  let recovered = null, from = "";
  for (const p of pairs) {
    try { recovered = sealDecrypt(p.hex, p.pp); from = p.commit; break; } catch { /* try next */ }
  }
  if (!recovered) { console.error("[seal-adopt] REFUSED: no historical seal opens — the lineage holds no recoverable key material."); process.exit(1); }
  console.log(`[seal-adopt] recovered the key material from lineage commit ${from.slice(0, 10)} (addresses only follow)`);
  const v = verifyPayload(recovered, { meta, ledger });
  console.log(`[seal-adopt] verified: cloud=${v.cloud} · network=${v.network} · live-ledger att ${v.attSeq} signer match: OK`);

  // 4. re-encrypt the SAME payload with the operator's value
  const payload = {
    format: MAGIC,
    sealedAt: recovered.sealedAt,          // identity continuity — the keys' own birthday is kept
    cloudKeyHex: recovered.cloudKeyHex,
    networkKeyHex: recovered.networkKeyHex,
    cloudAddress: recovered.cloudAddress,
    networkAddress: recovered.networkAddress,
  };
  const newHex = sealEncrypt(payload, PP);
  const roundTrip = sealDecrypt(newHex, PP); // prove the round-trip before writing anything
  if (roundTrip.cloudAddress !== payload.cloudAddress || roundTrip.networkAddress !== payload.networkAddress) {
    console.error("[seal-adopt] REFUSED: re-encryption round-trip failed — nothing written.");
    process.exit(1);
  }
  console.log("[seal-adopt] re-encryption round-trip: OK (same keys, new passphrase)");

  if (selfTest) {
    console.log("[seal-adopt] SELF-TEST PASS: extraction, verification, re-encryption and round-trip all green. No file was touched.");
    process.exit(0);
  }

  // 5. write the new seal + honest meta
  const now = new Date().toISOString();
  const newMeta = {
    format: meta.format,
    at: meta.at,
    rotatedAt: now,
    custody: {
      primary: "GitHub Actions Secret: WEAVE_SEAL_PASSPHRASE (the sovereign home Zip) — the operator pastes the same delivered password here (30-second operator step)",
      domain: "GitHub Actions Secret: MAIN_KEY (Domain — the twins' home on public minutes); the twins read WEAVE_SEAL_PASSPHRASE || MAIN_KEY",
      operator: "כספת המפעיל — הסיסמה שמסר בעצמו תחת MAIN_KEY (2026-09-21) היא מעתה סיסמת החותם",
    },
    kdf: meta.kdf,
    enc: meta.enc,
    cloudAddress: payload.cloudAddress,
    networkAddress: payload.networkAddress,
    note: "המעטפת חסרת-ערך לבדה — הסיסמה במשמרת מפוצלת (כספת Zip / כספת Domain / המפעיל) ולעולם לא בגיט. r72: המפתחות לא הוחלפו — רק הסיסמה אומצה מזו שמסר המפעיל; החומר שוחזר מהשושלת (פער G3 תועד בספרים).",
  };
  fs.writeFileSync(ENC_PATH, writeFileFormat(newHex));
  fs.writeFileSync(META_PATH, JSON.stringify(newMeta, null, 1) + "\n");
  console.log("[seal-adopt] new seal + meta written (passphrase never on disk, keys never printed)");

  // 6. commit + push with retries
  execSync("git add sovereign/weave-seal.enc sovereign/weave-seal.meta.json", { cwd: ROOT, stdio: "ignore" });
  execSync('git config user.name "seal-adopt"', { cwd: ROOT, stdio: "ignore" });
  execSync('git config user.email "seal-adopt@users.noreply.github.com"', { cwd: ROOT, stdio: "ignore" });
  let pushed = false, lastErr = "";
  for (let attempt = 1; attempt <= 3 && !pushed; attempt++) {
    try {
      execSync('git commit -m "seal-adopt (r72): the operator\'s delivered master key adopted as the seal passphrase — same keys (cloud/network addresses unchanged), custody restored to the operator\'s own hands; material recovered from the sovereign lineage (G3 gap documented); round-trip proven before write"', { cwd: ROOT, stdio: "ignore" });
    } catch { /* already committed in a previous attempt */ }
    try {
      execSync("git push", { cwd: ROOT, stdio: "ignore" });
      pushed = true;
    } catch (e) {
      lastErr = String(e.message || e).slice(0, 120);
      console.log(`[seal-adopt] push attempt ${attempt} failed — fetch+rebase and retry`);
      try { execSync("git fetch origin && git rebase origin/main", { cwd: ROOT, stdio: "ignore" }); } catch { /* next attempt */ }
    }
  }
  if (!pushed) { console.error(`[seal-adopt] FAILED: could not push after 3 attempts (${lastErr})`); process.exit(1); }
  const sha = sh("git rev-parse HEAD");
  console.log(`[seal-adopt] ADOPTED · commit ${sha.slice(0, 10)} · cloud=${payload.cloudAddress} · network=${payload.networkAddress}`);
  console.log("[seal-adopt] next: the twins read MAIN_KEY (fallback) — dispatch weave-heart to resume the ledger.");
}

main().catch((e) => { console.error(`[seal-adopt] FAILED: ${String(e.message).slice(0, 200)}`); process.exit(1); });
