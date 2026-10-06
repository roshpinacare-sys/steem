/* ─────────────────────────────────────────────────────────────────────
 * THE WEAVE · tron-custody (r187-A) — הוכחת-בעלות אופליין על כתובת-המשמרת
 *
 * רקע (r186): מבחן-הקשר גילה ש-32-הבתים של STEEM_ACTIVE_WIF מייצרים את
 * כתובת-המשמרת TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy — כלומר המפתח כבר בכספת.
 * הגל-הזה מקשיח את הגילוי לראיה-קריפטוגרפית:
 *   (1) חתימת-הודעה בסטנדרט TRON ("\x19TRON Signed Message:\n" + len + msg)
 *       עם המפתח-מהכספת;
 *   (2) ecrecover-עצמאי: המפתח-הציבורי-המשוחזר ≡ המפתח-שממנו-נגזרת-הכתובת;
 *   (3) יתרת-כתובת-חיה מ-trongrid בזמן-ההוכחה;
 *   (4) ארטיפקט atomic (tmp+rename) — אפס-סודות-בתוכו (בלי WIF, בלי מפתח).
 *
 * דוקטרינה: אפס-שידור. זו חתימה-אופליינית בלבד — כלום-לא-עוזב-את-הכספת
 * חוץ-מהחתימה-והכתובת-הציבורית. כל-קריאת-סוד נרשמת ב-access.log.
 * ───────────────────────────────────────────────────────────────────── */
import { readFileSync, existsSync, appendFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { ethers } from "ethers";
import bs58 from "bs58";

const require = createRequire(import.meta.url);
const GC = require(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "console", "gate-crypto.js"));

const VAULT = path.join(os.homedir(), ".sovereign", "vault");
const SEED_FILE = path.join(VAULT, "secrets", "STEEM_ACTIVE_WIF");
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "sovereign", "custody", "tron-custody-proof.json");
const CUSTODY = "TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy";

if (!existsSync(SEED_FILE)) {
  console.error("tron-custody: STEEM_ACTIVE_WIF לא בכספת — fail-closed");
  process.exit(2);
}
try { appendFileSync(path.join(VAULT, "access.log"), `${new Date().toISOString()} read STEEM_ACTIVE_WIF (tron-custody)\n`, { mode: 0o600 }); } catch { /* log never blocks */ }

/* ── עזרי-TRON (אותו-חוק-כמו check-tron-connection — selftest כפול) ── */
function base58check41(payload20: Buffer): string {
  const withPrefix = Buffer.concat([Buffer.from([0x41]), payload20]);
  const checksum = createHash("sha256").update(createHash("sha256").update(withPrefix).digest()).digest().slice(0, 4);
  return bs58.encode(Buffer.concat([withPrefix, checksum]));
}
function tronFromPrivBytes(privBytes: Buffer): string {
  const sk = new ethers.SigningKey(ethers.hexlify(privBytes));
  const h = ethers.keccak256("0x" + sk.publicKey.slice(4));
  return base58check41(Buffer.from(h.slice(-40), "hex"));
}

/* ── selftest: round-trip base58check41 על כתובת-המשמרת-עצמה ── */
const decoded = bs58.decode(CUSTODY);
if (decoded.length !== 25 || decoded[0] !== 0x41) throw new Error("selfTest: custody decode fail");
if (base58check41(decoded.slice(1, 21)) !== CUSTODY) throw new Error("selfTest: round-trip fail");

/* ── (1) המפתח-מהכספת → כתובת ── */
const wif = readFileSync(SEED_FILE, "utf8").trim();
const privBytes: Buffer = Buffer.from(await GC.wifToPriv(wif));
const derived = tronFromPrivBytes(privBytes);
const ownership = derived === CUSTODY ? "✓ DERIVATION-MATCH" : "✗ NO-MATCH";
console.log(`[derive] ${derived} ${ownership}`);

/* ── (2) חתימת-הודעה בסטנדרט TRON (ההודעה קושרת-את-ההוכחה לספר: cp-root + זמן) ── */
let cpRoot = "unknown";
try {
  const ledger = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "sovereign", "ledger.json"), "utf8")) as { checkpoints?: { root?: string }[] };
  const last = ledger.checkpoints?.[ledger.checkpoints.length - 1];
  if (last?.root) cpRoot = String(last.root);
} catch { /* fail-soft — ההוכחה לא תלויה בספר */ }
const provedAt = new Date().toISOString();
const message = `THE WEAVE custody proof · ${CUSTODY} · cp-root ${cpRoot} · ${provedAt}`;
const prefixed = ethers.toUtf8Bytes("\x19TRON Signed Message:\n" + String(message.length) + message);
const digest = ethers.keccak256(prefixed);
const sk = new ethers.SigningKey(ethers.hexlify(privBytes));
const sig = sk.sign(digest);

/* ── (3) ecrecover-עצמאי: ההודעה-החתומה משוחזרת-לכתובת-EVM-של-המפתח-הנכון ──
 * ethers-v6 חושף recoverAddress בלבד — משווים מול כתובת-EVM שנגזרה מהמפתח
 * הגולמי (אותו-math שמייצר את כתובת-ה-TRON; קשירה-מלאה sig↔key↔addr). */
const evmOfKey = ethers.computeAddress(sk.publicKey);
const recoveredEvm = ethers.recoverAddress(digest, sig);
const sigVerified = recoveredEvm === evmOfKey;

/* ── (4) יתרה-חיה מ-trongrid ── */
let balanceTrx: number | null = null;
try {
  const res = await fetch(`https://api.trongrid.io/v1/accounts/${CUSTODY}`, { signal: AbortSignal.timeout(15000) });
  const j = (await res.json()) as { data?: { balance?: number }[] };
  balanceTrx = j.data?.[0] ? (j.data[0].balance ?? 0) / 1e6 : 0;
} catch { balanceTrx = null; }

/* ── ארטיפקט atomic — אפס-סודות ── */
const artifact = {
  schema: "weave/custody-proof/1",
  provedAt,
  chain: "TRON",
  address: CUSTODY,
  derivedFrom: "STEEM_ACTIVE_WIF (vault) — 32 raw bytes",
  derivationMatch: derived === CUSTODY,
  message,
  signature: { r: sig.r, s: sig.s, yParity: sig.yParity },
  tronMessagePrefix: "\\x19TRON Signed Message:\\n{len}",
  recoveredAddressEvm: recoveredEvm,
  signatureVerified: sigVerified,
  liveBalanceTrx: balanceTrx,
  balanceSource: "https://api.trongrid.io/v1/accounts",
  broadcast: "NONE — offline signature only (D-OP-01 doctrine)",
  verdict: derived === CUSTODY && sigVerified ? "PROVED" : "FAILED",
};
if (derived === CUSTODY && sigVerified) {
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT + ".tmp", JSON.stringify(artifact, null, 1) + "\n");
  renameSync(OUT + ".tmp", OUT);
}
console.log(`[sign] sig.r=${sig.r.slice(0, 12)}… · recovered=${recoveredEvm} ${sigVerified ? "✓ SIG-VERIFIED" : "✗ FAIL"}`);
console.log(`[balance] ${balanceTrx == null ? "trongrid לא נענה" : balanceTrx + " TRX (חיה)"}`);
console.log(`[verdict] ${artifact.verdict}${artifact.verdict === "PROVED" ? ` → ${path.relative(process.cwd(), OUT)}` : ""}`);
