/* ─────────────────────────────────────────────────────────────────────
 * THE WEAVE · check-tron-connection — בדיקת הקשר בין ה-owner/active
 * של @headcorner לבין ה-mnemonic (TRON) שהופיע בתמונת המפעיל.
 *
 * דוקטרינה: אפס סוד מודפס אי-פעם — רק כתובות ציבוריות וטביעות-אצבע
 * (4-6 תווים ראשונים). הסיסמה נקראת מ-upload/headcorner.txt בזיכרון בלבד.
 *
 * מודד:
 *  (1) ה-owner (סיסמת-אב) → גזירת active/owner/posting/memo ← השוואה ביט-מול-ביט
 *      מול הרשויות החיות של @headcorner (נמדדו עכשיו מ-api.steemit.com).
 *  (2) ה-mnemonic שבתמונה (12 מילים) → כתובות TRON בנתיבי BIP44 סטנדרטיים
 *      (m/44'/195'/0'/0/i וכמה וריאנטים) + בדיקת תקפות BIP39.
 *  (3) מבחן-הקשר א': האם ה-bytes הגולמיים של מפתחות ה-Steem (ה-32 בתים
 *      שבתוך ה-WIF) מייצרים את אותה כתובת TRON כמו ה-mnemonic — כלומר:
 *      אם מישהו היה מייבא את ה-active של Steem כמפתח פרטי בארנק TRON.
 *  (4) מבחן-הקשר ב': האם סיסמת-האב משמשת כ-passphrase של BIP39 לאותו mnemonic.
 *  (5) השוואת כל הכתובות הנגזרות מול כתובות הצי החיות (משמרת/צבא/פדיון).
 * ───────────────────────────────────────────────────────────────────── */
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { ethers } from "ethers";
import bs58 from "bs58";

const require = createRequire(import.meta.url);
const GC = require(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "console", "gate-crypto.js"));

/* ── קלטים ── */
// r186-a תיקון-דימום: ה-mnemonic כבר לא בקוד (היה עקוב-בגיט מאז 0e252dab — דימום-סוד).
// הוא נאטם בכספת הסוכנים (TRON_SEED, 0600) והסקריפט קורא אותו משם בלבד — fail-closed.
import os from "node:os";
const VAULT_SEED = path.join(os.homedir(), ".sovereign", "vault", "secrets", "TRON_SEED");
if (!existsSync(VAULT_SEED)) {
  console.error("check-tron-connection: TRON_SEED לא נמצא בכספת (~/.sovereign/vault/secrets/TRON_SEED) — כיבוי-סגור, אפס-נפילה-לברירת-מחדל");
  process.exit(2);
}
try { appendFileSync(path.join(os.homedir(), ".sovereign", "vault", "access.log"), `${new Date().toISOString()} read TRON_SEED (check-tron-connection)\n`, { mode: 0o600 }); } catch { /* log never blocks */ }
const MNEMONIC = readFileSync(VAULT_SEED, "utf8").trim();

const lines = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "upload", "headcorner.txt"),
  "utf8"
).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const ACCOUNT = lines[0];
const PASSWORD = lines[lines.length - 1];

/* ── רשויות חיות — נמדדו מ-api.steemit.com ברגע כתיבת הסקריפט (הפעלה חיה) ── */
const LIVE = {
  owner:   "STM5aUKyd9LzENnMti5tS478Zu1SLJW51VHyu2gvSNGKhwfyMFpvv",
  active:  "STM5HhJD5WUXu8vPhDmLaC2fTuuJYkwxF62Rt17HZ5G2PbnBvuHXF",
  posting: "STM8m3rBLd8CA2KkY764fkFBnYGoCaK1ktDjn825HUbq25i52N9cw",
  memo:    "STM7mBK98NCE3HfMhqB9ADdxTutE1RSyGzpJQ6xiybr7gbmpQcXM9",
};

/* ── כתובות הצי — נמדדו חי מהקונסולה הציבורית (money.json / watch.json / receipts) ── */
const FLEET = {
  "custody-משמרת":  "TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy",
  "army-צבא-TRON":  "TVESRr1TX1RaKzsN6TKszutJBFDPEGPx1e",
  "outbox-פדיון":   "TG6SrsMJjRqnqAyYM8kGZu1rgkpsgizKEn",
};

/* ── TRON: base58check(0x41 ‖ keccak256(pubkey-uncompressed)[12:]) ── */
function base58check41(payload20) {
  const withPrefix = Buffer.concat([Buffer.from([0x41]), payload20]);
  const checksum = createHash("sha256")
    .update(createHash("sha256").update(withPrefix).digest())
    .digest().slice(0, 4);
  return bs58.encode(Buffer.concat([withPrefix, checksum]));
}
function tronFromPrivBytes(privBytes) {
  const sk = new ethers.SigningKey(ethers.hexlify(privBytes));
  const uncompressed = sk.publicKey; // לא-מכווץ: 0x04 ‖ X ‖ Y (130 hex)
  const h = ethers.keccak256("0x" + uncompressed.slice(4));
  return base58check41(Buffer.from(h.slice(-40), "hex"));
}

/* ── בדיקות-עצמי (מוכיחות שהגזירה נכונה לפני כל שימוש) ── */
(function selfTest() {
  // (א) base58check round-trip על כתובת המשמרת האמיתית: decode ← encode ≡ אותה כתובת
  const decoded = bs58.decode(FLEET["custody-משמרת"]); // 25 bytes
  if (decoded.length !== 25 || decoded[0] !== 0x41) throw new Error("selfTest: custody decode fail");
  const reEnc = base58check41(decoded.slice(1, 21)); // 20 בתים בלי הקידומת 0x41 — הפונקציה מוסיפה אותה בעצמה
  if (reEnc !== FLEET["custody-משמרת"]) throw new Error("selfTest: base58check41 round-trip fail: " + reEnc);
  // (ב) הצלבת keccak: 20 הבתים האחרונים ≡ כתובת EVM של ethers על 3 מפתחות אקראיים
  for (let i = 0; i < 3; i++) {
    const w = ethers.Wallet.createRandom();
    const sk = new ethers.SigningKey(w.privateKey);
    const h = ethers.keccak256("0x" + sk.publicKey.slice(4));
    if (("0x" + h.slice(-40)).toLowerCase() !== w.address.toLowerCase()) throw new Error("selfTest: keccak cross-check fail " + i);
  }
  console.log("[selfTest] ✓ base58check41 round-trip (כתובת המשמרת החיה) · ✓ keccak cross-check (ethers.Wallet ×3)");
})();
const fleetSet = new Set(Object.values(FLEET));
function fleetHit(addr) {
  const hit = Object.entries(FLEET).find(([, a]) => a === addr);
  return hit ? `  ★ FLEET MATCH: ${hit[0]}` : "";
}

/* ═══ (1) ה-owner → ה-active: אימות מול השרשרת ═══ */
console.log("═══ (1) owner → active · אימות מול הרשויות החיות של @" + ACCOUNT + " ═══");
console.log(`[i] password fingerprint: ${PASSWORD.slice(0, 4)}… (${PASSWORD.length} chars)`);
const steemDerives = {};
for (const role of ["owner", "active", "posting", "memo"]) {
  const wif = await GC.masterToWif(ACCOUNT, role, PASSWORD);
  const priv = await GC.wifToPriv(wif);
  const pub = await GC.pubToSTM(GC.privToPubBytes(priv));
  const ok = pub === LIVE[role] ? "✓ MATCH-LIVE" : "✗ NO-MATCH";
  console.log(`  master/${role.padEnd(7)} pub=${pub.slice(0, 16)}… ${ok}  (WIF fp ${wif.slice(0, 5)}… len ${wif.length})`);
  steemDerives[role] = { priv, pub, wif };
}

/* ═══ (2) ה-mnemonic מהתמונה → כתובות TRON ═══ */
console.log("\n═══ (2) ה-mnemonic שבתמונה → כתובות TRON (BIP44) ═══");
const valid = ethers.Mnemonic.isValidMnemonic(MNEMONIC);
console.log(`  BIP39 תקין (12 מילים, checksum): ${valid ? "✓ YES" : "✗ NO"}`);
const words = MNEMONIC.split(" ");
console.log(`  מילים: ${words.length} · טביעת-אצבע: ${words[0]}…/${words[words.length - 1]}`);

const root = ethers.HDNodeWallet.fromPhrase(MNEMONIC, null, "m");
const paths = [];
for (let i = 0; i < 10; i++) paths.push(`m/44'/195'/0'/0/${i}`);
paths.push("m/44'/195'/0'", "m/44'/195'", "m/44'/60'/0'/0/0");
const mnemonicAddrs = [];
for (const p of paths) {
  const w = root.derivePath(p);
  const addr = tronFromPrivBytes(Buffer.from(w.privateKey.slice(2), "hex"));
  mnemonicAddrs.push({ p, addr });
  console.log(`  ${p.padEnd(22)} → ${addr}${fleetHit(addr)}`);
}

/* ═══ (3) מבחן-הקשר א': מפתחות ה-Steem כמפתחות TRON גולמיים ═══ */
console.log("\n═══ (3) מבחן-קשר א׳: ה-active (וחבריו) של Steem כמפתח-TRON גולמי ═══");
console.log("  (אם היו מייבאים את 32 הבתים שבתוך ה-WIF לארנק TRON — איזו כתובת הייתה נוצרת)");
const steemAsTron = {};
for (const role of ["active", "owner", "posting", "memo"]) {
  const addr = tronFromPrivBytes(steemDerives[role].priv);
  steemAsTron[role] = addr;
  console.log(`  ${role.padEnd(7)} → TRON ${addr}${fleetHit(addr)}`);
}
// האם כתובת-ה-TRON של ה-active זהה לאחת מכתובות ה-mnemonic?
const activeTronMatchesMnemonic = mnemonicAddrs.filter(m => m.addr === steemAsTron.active);
console.log(`  ה-active כ-TRON ≡ כתובת מה-mnemonic? ${activeTronMatchesMnemonic.length ? "★ YES: " + activeTronMatchesMnemonic.map(m => m.p).join(",") : "✗ NO — אין חפיפה"}`);

/* ═══ (4) מבחן-הקשר ב': סיסמת-האב כ-BIP39 passphrase ל-mnemonic ═══ */
console.log("\n═══ (4) מבחן-קשר ב׳: סיסמת-האב כ-passphrase של BIP39 ═══");
try {
  const rootP = ethers.HDNodeWallet.fromPhrase(MNEMONIC, PASSWORD, "m");
  const w = rootP.derivePath("m/44'/195'/0'/0/0");
  const addr = tronFromPrivBytes(Buffer.from(w.privateKey.slice(2), "hex"));
  console.log(`  m/44'/195'/0'/0/0 (עם passphrase=סיסמת-האב) → ${addr}${fleetHit(addr)}`);
  console.log(`  ≡ הכתובת בלי passphrase? ${addr === mnemonicAddrs[0].addr ? "YES — הסיסמה לא משפיעה" : "NO — כתובת שונה"}`);
} catch (e) {
  console.log("  נכשל:", e.message);
}

/* ═══ (5) מסכם ═══ */
console.log("\n═══ (5) מטריצת-הקשר מול כתובות הצי ═══");
const allDerived = [
  ...mnemonicAddrs.map(m => ({ src: "mnemonic " + m.p, addr: m.addr })),
  ...Object.entries(steemAsTron).map(([r, a]) => ({ src: "steem-" + r + " כ-TRON", addr: a })),
];
let anyHit = false;
for (const { src, addr } of allDerived) {
  const hit = Object.entries(FLEET).find(([, a]) => a === addr);
  if (hit) { anyHit = true; console.log(`  ★ ${src} → ${hit[0]} (${addr})`); }
}
if (!anyHit) console.log("  ✗ אף כתובת נגזרת (mnemonic או מפתחות Steem כ-TRON) אינה מכתובות הצי.");
console.log("\n[כתובות הצי שנבדקו מולן — נמדדו חי מהקונסולה]:");
for (const [k, v] of Object.entries(FLEET)) console.log(`  ${k.padEnd(16)} ${v}`);
