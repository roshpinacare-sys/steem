// ─────────────────────────────────────────────────────────────────────
// HIVE-KEY-PROVE — הוכחת-בעלות על מפתח-posting של headcorner ב-Hive (r181)
//
// דבר-ה-owner (trace 1a102dc504a2e6f9): "יש לך הכל" — וזו ההוכחה: המפתח
// היה אצלנו כל-הזמן בכספת-הארנק (db/wallet-vault.db · hive/headcorner/
// posting · STM6u99… · verified).
//
// הזרימה (אותו קריפטו של wallet-vault.ts / R101c — השרשרת היא השופטת):
//   סיסמת-אב (upload/headcorner.txt) → toWif(active) → חותמת לפי הפומבי
//   → scrypt(WIF,salt) KEK → מפתח-אב → AES-256-GCM → כל-רשומות
//   hive/headcorner/posting → שלוש-הצגות (WIF-מחרוזת · hex-32 · גלם-33)
//   → נגזרת-פומבית → השוואה מול הרשות החיה ב-api.hive.blog (קריאה בלבד).
//
// הכללים: חומר-המפתח חי בזיכרון-הרצה בלבד — לא מודפס, לא נכתב, לא נשלח.
// הקבלה נושאת פומבי-בלבד. כתיבה אטומית (tmp+rename, R107b). אפס שידור.
//
// Usage: bun scripts/hive-key-prove.mjs
// ─────────────────────────────────────────────────────────────────────

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { readFileSync } from "node:fs";
import { Database } from "bun:sqlite";

const HOME = "/home/z/my-project";
const OWNER_FILE = path.join(HOME, "upload", "headcorner.txt");
const WALLET_DB = process.env.WALLET_DB || path.join(HOME, "db", "wallet-vault.db");
const HIVE_RPC = "https://api.hive.blog";
const RECEIPT_PATH = "sovereign/vault/hive-key-proof.json";
const ACCOUNT = "headcorner";
const ROLE = "posting";
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };

function normalizePub(pub) {
  return String(pub ?? "").replace(/^(STM|HIVE|BLT)/, "");
}

function aesGcmOpen(key, ctHex, ivHex, tagHex) {
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  d.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([d.update(Buffer.from(ctHex, "hex")), d.final()]);
}

/* base58check → WIF (גרסה 0x80) — למקרה שהרשומה שמורה כחומר-גלם ולא כמחרוזת-WIF */
const B58A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(buf) {
  let n = 0n;
  for (const b of buf) n = (n << 8n) | BigInt(b);
  let s = "";
  while (n > 0n) { s = B58A[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = "1" + s; else break; }
  return s;
}
function toWifFromRaw(key32) {
  const payload = Buffer.concat([Buffer.from([0x80]), key32]);
  const chk = crypto.createHash("sha256").update(crypto.createHash("sha256").update(payload).digest()).digest().subarray(0, 4);
  return b58(Buffer.concat([payload, chk]));
}

function readOwnerControlWif() {
  const raw = readFileSync(OWNER_FILE, "utf8").trim();
  const lines = raw.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const account = lines[0];
  const secret = lines[1] ?? "";
  if (!account || !secret) return null;
  const steem = createRequire(path.join(HOME, "package.json"))("steem");
  if (secret.startsWith("wif:")) return { account, controlWif: secret.slice(4).trim(), mode: "wif" };
  return { account, controlWif: steem.auth.toWif(account, secret, "active"), mode: "master" };
}

async function liveHivePostingPub() {
  const r = await fetch(HIVE_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [[ACCOUNT]], id: 1 }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j?.result?.[0]?.posting?.key_auths?.[0]?.[0] ?? null;
}

/** ניסיון להפיק פומבי-גרפני מחומר-גלם בשלוש-הצגות. null = נכשל בכנות. */
function derivePubFromMaterial(steem, buf) {
  const attempts = [];
  // הצגה 1: מחרוזת-WIF ישירה
  attempts.push(() => steem.auth.wifToPublic(buf.toString("utf8").trim()));
  // הצגה 2: hex-32 → WIF
  attempts.push(() => {
    const hex = buf.toString("utf8").trim();
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("not-hex32");
    return steem.auth.wifToPublic(toWifFromRaw(Buffer.from(hex, "hex")));
  });
  // הצגה 3: גלם-בינארי 32/33 (0x80+32) → WIF
  attempts.push(() => {
    const raw = buf.length === 33 && buf[0] === 0x80 ? buf.subarray(1) : buf;
    if (raw.length !== 32) throw new Error("not-32");
    return steem.auth.wifToPublic(toWifFromRaw(raw));
  });
  for (const a of attempts) {
    try { const p = a(); if (p && String(p).length > 40) return String(p); } catch { /* הצגה-הבאה */ }
  }
  return null;
}

const src = readOwnerControlWif();
if (!src) {
  console.error("[prove] ✗ NO-OWNER-SOURCE");
  process.exit(1);
}
const steem = createRequire(path.join(HOME, "package.json"))("steem");
const controlPub = steem.auth.wifToPublic(src.controlWif);

if (!fs.existsSync(WALLET_DB)) {
  console.error("[prove] ✗ NO-WALLET-DB");
  process.exit(1);
}
const db = new Database(WALLET_DB, { readonly: true });
const cfgRow = db.query("SELECT keySeals FROM GateConfig WHERE id = 'gate'").get();
const seals = JSON.parse(cfgRow.keySeals);
const seal = seals.find((s) => s.pub === controlPub);
if (!seal) {
  console.error(`[prove] ✗ NO-SEAL-FOR-KEY (${controlPub.slice(0, 12)}…)`);
  process.exit(1);
}
const kek = crypto.scryptSync(src.controlWif, Buffer.from(seal.kdfSalt, "hex"), 32, SCRYPT);
const masterHex = aesGcmOpen(kek, seal.encMaster, seal.sealIv, seal.sealTag).toString("utf8");
if (!/^[0-9a-fA-F]{64}$/.test(masterHex)) {
  console.error("[prove] ✗ BAD-MASTER");
  process.exit(1);
}
const master = Buffer.from(masterHex, "hex");
const rows = db
  .query("SELECT pub, encPriv, privIv, privTag, status FROM VaultEntry WHERE chain = 'hive' AND account = ? AND role = ? ORDER BY status = 'verified' DESC, id DESC")
  .all(ACCOUNT, ROLE);

const livePub = await liveHivePostingPub();
if (!livePub) {
  console.error("[prove] ✗ LIVE-RPC-FAILED — השרשרת לא נענתה; אין שופט, אין פסק-דין");
  process.exit(1);
}

// השופט האמיתי הוא הרשות החיה — סורקים את כל-הרשומות ומוצאים את-זו-שמתאימה
let best = null;
for (const row of rows) {
  let derivedPub = null;
  try {
    const buf = aesGcmOpen(master, row.encPriv, row.privIv, row.privTag);
    derivedPub = derivePubFromMaterial(steem, buf);
  } catch { derivedPub = null; }
  const entryMatch = !!derivedPub && normalizePub(derivedPub) === normalizePub(row.pub);
  const liveMatch = !!derivedPub && normalizePub(derivedPub) === normalizePub(livePub);
  if (!best || (liveMatch && !best.liveMatch)) {
    best = { row, derivedPub, entryMatch, liveMatch };
  }
  if (liveMatch) break; // נמצא — השופט דיבר
}

const receipt = {
  schema: "weave/vault-key-proof/1",
  at: new Date().toISOString(),
  chain: "hive",
  account: ACCOUNT,
  role: ROLE,
  source: "db/wallet-vault.db (owner-file → active → seal → master → AES-GCM)",
  mode: src.mode,
  rowsScanned: rows.length,
  entryPub: best?.row?.pub ?? null,
  derivedPub: best?.derivedPub ?? null,
  livePub,
  entryMatch: !!best?.entryMatch,
  liveMatch: !!best?.liveMatch,
  verdict: best?.entryMatch && best?.liveMatch ? "PROVED" : best?.liveMatch ? "PROVED-LIVE-ONLY" : "REJECTED",
  note: "חומר-המפתח מעולם לא הודפס ולא נכתב — פומבי-בלבד; אפס שידור בהוכחה זו",
};

fs.mkdirSync("sovereign/vault", { recursive: true });
fs.writeFileSync(`${RECEIPT_PATH}.tmp`, JSON.stringify(receipt, null, 2) + "\n");
fs.renameSync(`${RECEIPT_PATH}.tmp`, RECEIPT_PATH);

console.log(`[prove] rows scanned: ${rows.length}`);
console.log(`[prove] entryPub: ${receipt.entryPub ?? "?"}`);
console.log(`[prove] derivedPub: ${receipt.derivedPub ?? "?"}`);
console.log(`[prove] livePub: ${livePub}`);
console.log(`[prove] entryMatch: ${receipt.entryMatch} · liveMatch: ${receipt.liveMatch} · verdict: ${receipt.verdict}`);
console.log(`[prove] receipt → ${RECEIPT_PATH}`);
process.exit(receipt.liveMatch ? 0 : 2);
