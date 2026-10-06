#!/usr/bin/env bun
/**
 * vault-keyring — הכספת-הקבועה של THE WEAVE (r180)
 *
 * דבר-המפעיל שבנה-את-זה: "ה-owner-תמיד-יכול-לתת-לך-את-כל-המפתחות. תמשיך
 * ואטום-הכל-בכספת-לסוכנים-שיוכלו-להשתמש-תמיד" (trace 1a102cb729019709).
 * זו-התשובה: טקס-קבלה-קבוע-משרשרת-מפתח-אחת-עד-סוף — ה-owner-נותן,
 * הכספת-חותמת, הסוכנים-קוראים-לנצח.
 *
 * פורמט-הבית (זהה-ל-seal): scrypt(N=2^14) + aes-256-gcm · envelope
 * salt(16)+iv(12)+tag(16)+ct · קובץ = MAGIC + שורות-hex של 100.
 * ה-blob-המוצפן-חי-בגיט (כמו weave-seal.enc) — חסר-ערך-בלי-הסיסמה,
 * שמשמרת-מפוצלת (Actions-Secret / המפעיל) ולעולם-לא-בגיט-ולא-בלוגים.
 *
 * טביעות-אצבע-ציבוריות-בלבד ב-manifest.json:
 *   · steem/hive-WIF → המפתח-הציבורי (STM… דרך steem.auth.wifToPublic)
 *   · evm → הכתובת (דרך ethers)
 *   · אחר → sha256-16hex עם-הערה-הכנה
 * המטריאל-עצמו-מעולם-לא-נדפס-בלוגים-ולא-נשמר-מחוץ-ל-blob.
 *
 * Usage:
 *   WEAVE_KEYRING_PASS=… echo "MATERIAL" | bun scripts/vault-keyring.mjs add hive-posting --type hive-wif --stdin
 *   WEAVE_KEYRING_PASS=… bun scripts/vault-keyring.mjs list
 *   WEAVE_KEYRING_PASS=… bun scripts/vault-keyring.mjs get hive-posting   # מדפיס-ל-stdout (לצינור-בלבד)
 *   WEAVE_KEYRING_PASS=… bun scripts/vault-keyring.mjs remove TEST-x
 *   bun scripts/vault-keyring.mjs self-test
 */

import * as crypto from "node:crypto";
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const MAGIC = "WEAVE-KEYRING-1";
const RING_FILE = "sovereign/vault/keyring.seal";
const MANIFEST = "sovereign/vault/manifest.json";
const KEY_TYPES = ["steem-wif", "hive-wif", "evm-key", "passphrase", "other"];

const args = process.argv.slice(2);
const cmd = args[0];

function fail(msg, code = 1) {
  console.error(`[vault] ✗ ${msg}`);
  process.exit(code);
}

function passphrase() {
  // שרשרת-המשמרת-של-התאומים (כמו-Domain): המפתחרת-הייעודית-ראשונה, ואז-סיסמת-החותם.
  // מאסטר-אחד-לכל-הבית — ה-owner-מנהל-סוד-אחד, לא-שניים.
  const p = (process.env.WEAVE_KEYRING_PASS || process.env.WEAVE_SEAL_PASSPHRASE || process.env.MAIN_KEY || "").trim();
  if (p.length < 8) fail("אין-משמרת-בסביבה (WEAVE_KEYRING_PASS || WEAVE_SEAL_PASSPHRASE || MAIN_KEY) — הכספת-סוגרת. הסיסמה-במשמרת-מפוצלת ולעולם-לא-בגיט", 2);
  return p;
}

// ── envelope (פורמט-הבית) ───────────────────────────────────────────
function sealEncrypt(payloadObj, pass) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pass, salt, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(payloadObj), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, ct]).toString("hex");
}
function parseSealFile(raw) {
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  if (lines[0] !== MAGIC) throw new Error("bad-magic");
  return lines.slice(1).join("");
}
function sealDecrypt(hex, pass) {
  const payload = Buffer.from(hex, "hex");
  const key = crypto.scryptSync(pass, payload.subarray(0, 16), 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, payload.subarray(16, 28));
  decipher.setAuthTag(payload.subarray(28, 44));
  const pt = Buffer.concat([decipher.update(payload.subarray(44)), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(pt);
  if (parsed.format !== MAGIC) throw new Error("unrecognized-keyring");
  return parsed;
}
function writeRing(ring, pass) {
  // R107b — כתיבה-אטומית: הסוכנים-קוראים-את-הקובץ; שבר-JSON-אסור
  mkdirSync("sovereign/vault", { recursive: true });
  const hex = sealEncrypt(ring, pass);
  const body = MAGIC + "\n" + (hex.match(/.{1,100}/g) ?? []).join("\n") + "\n";
  writeFileSync(`${RING_FILE}.tmp`, body);
  renameSync(`${RING_FILE}.tmp`, RING_FILE);
}
function loadRing(pass) {
  if (!existsSync(RING_FILE)) return { format: MAGIC, keys: [] };
  try {
    return sealDecrypt(parseSealFile(readFileSync(RING_FILE, "utf8")), pass);
  } catch {
    fail("AEAD-סירב — הסיסמה-אינה-תואמת-לכספת-הקיימת (או-קובץ-פגום). שום-דבר-לא-נפתח, שום-דבר-לא-נכתב. אם-המשמרת-השתנתה-בכוונה — הסר-ידנית-את-keyring.seal-והתחל-טקס-חדש", 3);
  }
}

// ── טביעות-אצבע-ציבוריות ───────────────────────────────────────────
function fingerprint(material, type) {
  if (type === "steem-wif" || type === "hive-wif") {
    try {
      const steem = require("steem");
      return { pub: steem.auth.wifToPublic(material) };
    } catch { return { digest: crypto.createHash("sha256").update(material).digest("hex").slice(0, 16), note: "wifToPublic-נכשל — טביעת-digest" }; }
  }
  if (type === "evm-key") {
    try {
      const { ethers } = require("ethers");
      return { address: new ethers.Wallet(material).address };
    } catch { return { digest: crypto.createHash("sha256").update(material).digest("hex").slice(0, 16), note: "evm-כתובת-נכשלה" }; }
  }
  return { digest: crypto.createHash("sha256").update(material).digest("hex").slice(0, 16), note: "digest-בלבד" };
}

function validateMaterial(material, type) {
  // r180 — סינון-כנות-בשער-הכספת: מטריאל-שטוען-להיות-מפתח-ואינו-מפתח-נדחה-בשער,
  // לא-אחרי-החיתום. ההצהרה-הקריפטוגרפית-נבדקת-עכשיו, לא-בזמן-הצריכה.
  if (type === "steem-wif" || type === "hive-wif") {
    let pub = null;
    try { pub = require("steem").auth.wifToPublic(material); } catch { /* נופל-למטה */ }
    if (!pub || typeof pub !== "string" || !pub.startsWith("STM")) {
      fail(`מטריאל-אינו-WIF-תקין (wifToPublic-כשל) — נדחה-בשער. אם-זה-מפתח-מהסוג-האחר, הכרז-type-נכון`);
    }
    return pub;
  }
  if (type === "evm-key") {
    try { new (require("ethers").Wallet)(material); return null; } catch { fail("מטריאל-אינו-מפתח-EVM-תקין — נדחה-בשער"); }
  }
  return null;
}

function writeManifest(ring) {
  mkdirSync("sovereign/vault", { recursive: true });
  const manifest = {
    schema: "weave-keyring-manifest-v1",
    at: new Date().toISOString(),
    note: "קבלה-ציבורית בלבד — טביעות-אצבע-ציבוריות; המטריאל-ב-keyring.seal-המוצפן-בלבד",
    custody: "WEAVE_KEYRING_PASS — משמרת-מפוצלת (Actions-Secret / המפעיל), לעולם-לא-בגיט",
    keys: ring.keys.map((k) => ({ alias: k.alias, type: k.type, ...k.fp, addedAt: k.addedAt, note: k.note ?? null })),
  };
  writeFileSync(`${MANIFEST}.tmp`, JSON.stringify(manifest, null, 2) + "\n");
  renameSync(`${MANIFEST}.tmp`, MANIFEST);
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8").trim();
}

// ── פקודות ─────────────────────────────────────────────────────────
const pass = cmd === "self-test" ? null : passphrase();
const ring = cmd === "self-test" ? null : loadRing(pass);

if (cmd === "add") {
  const alias = args[1]?.trim();
  const ti = args.indexOf("--type");
  const type = ti > -1 ? args[ti + 1] : "other";
  if (!alias || !/^[a-z0-9-]{2,40}$/i.test(alias)) fail("alias-חסר-או-לא-תקין ([a-z0-9-]{2,40})");
  if (!KEY_TYPES.includes(type)) fail(`type-חייב-להיות-אחד-מ: ${KEY_TYPES.join(", ")}`);
  if (!args.includes("--stdin")) fail("קבלת-מטריאל-רק-דרך --stdin (מעולם-לא-argv — נשאר-מחוץ-להיסטוריית-פקודות)");
  const material = await readStdin();
  if (!material) fail("stdin-ריק — אין-מטריאל");
  const validatedPub = validateMaterial(material, type); // דוחה-בשער-בכנות
  if (ring.keys.some((k) => k.alias === alias)) fail(`alias-קיים-כבר: ${alias} — remove-קודם`);
  ring.keys.push({ alias, type, material, fp: fingerprint(material, type), addedAt: new Date().toISOString(), note: args.includes("--note") ? args[args.indexOf("--note") + 1] : null });
  writeRing(ring, pass);
  writeManifest(ring);
  console.log(`[vault] ✓ חתום-ואטום: ${alias} (${type})${validatedPub ? ` · מפתח-ציבורי: ${validatedPub}` : ""} · טביעת-אצבע: ${JSON.stringify(ring.keys[ring.keys.length - 1].fp)}`);
} else if (cmd === "get") {
  const k = ring.keys.find((x) => x.alias === args[1]);
  if (!k) fail(`לא-נמצא: ${args[1]}`);
  process.stdout.write(k.material);
} else if (cmd === "remove") {
  const before = ring.keys.length;
  ring.keys = ring.keys.filter((x) => x.alias !== args[1]);
  if (ring.keys.length === before) fail(`לא-נמצא: ${args[1]}`);
  writeRing(ring, pass);
  writeManifest(ring);
  console.log(`[vault] ✓ הוסר-ונקבר: ${args[1]}`);
} else if (cmd === "list") {
  console.log(ring.keys.map((k) => `${k.alias} · ${k.type} · ${k.fp.pub ?? k.fp.address ?? k.fp.digest} · ${k.addedAt}`).join("\n") || "(ריק)");
} else if (cmd === "status") {
  const exists = existsSync(RING_FILE);
  let match = null, count = 0;
  if (exists) {
    try { const r = sealDecrypt(parseSealFile(readFileSync(RING_FILE, "utf8")), pass); match = true; count = r.keys.length; } catch { match = false; }
  }
  console.log(JSON.stringify({ ringFile: exists, passMatch: match, keys: count, custody: "WEAVE_KEYRING_PASS || WEAVE_SEAL_PASSPHRASE || MAIN_KEY" }));
} else if (cmd === "self-test") {
  // הוכחה-אנד-אנד-בלי-לגעת-בכספת-האמיתית: טבעת-זמנית-ב/tmp
  const home = process.cwd();
  process.chdir("/tmp");
  const tmpPass = "vault-self-test-pass-r180";
  const tpass = () => tmpPass;
  // מקרה-בדיקה: WIF-אמיתי-מקומי מ-brain-key-בדיקה (הספרייה-הרשמית)
  const steem = require(require("path").join(home, "node_modules", "steem"));
  const testWif = steem.auth.toWif("the-weave-vault-self-test-r180");
  const pub = steem.auth.wifToPublic(testWif);
  const mk = (keys) => ({ format: MAGIC, keys });
  // seal→open→roundtrip
  const ringObj = mk([{ alias: "test-key", type: "steem-wif", material: testWif, fp: {}, addedAt: "t" }]);
  const hex = sealEncrypt(ringObj, tmpPass);
  const back = sealDecrypt(hex, tmpPass);
  if (back.keys[0].material !== testWif) fail("self-test: roundtrip-נכשל");
  let wrongPassRejected = false;
  try { sealDecrypt(hex, "wrong-pass-attempt"); } catch { wrongPassRejected = true; }
  if (!wrongPassRejected) fail("self-test: סיסמה-שגויה-עברה?! (AEAD-חייב-לזרוק)");
  if (fingerprint(testWif, "steem-wif").pub !== pub) fail("self-test: טביעת-אצבע-לא-תואמת");
  console.log(`[vault] self-test ✓ — envelope-עגול · AEAD-דוחה-סיסמה-שגויה · טביעת-אצבע-ציבורית מתאימה (${pub.slice(0, 12)}…) · מקור: /tmp — הכספת-האמיתית-לא-נגעה`);
  process.chdir(home);
} else {
  fail(`שימוש: add <alias> --type <t> --stdin | get <alias> | remove <alias> | list | status | self-test`);
}
