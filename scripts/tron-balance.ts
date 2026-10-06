/* ─────────────────────────────────────────────────────────────────────
 * THE WEAVE · tron-balance (r188) — כלי-היתרות-החי של מסילת-TRON
 *
 * רקע: r187-A הוכיח בעלות חתימה-אופליינית על כתובת-המשמרת
 * TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy (מפתח ≡ 32 בתים של STEEM_ACTIVE_WIF).
 * r188 מחבר את המסילה: כלי-קריאה-חי קבוע — TRX + USDT-TRC20 מ-trongrid,
 * כתובת-נגזרת-מהכספת (אפס-הקשה), ארטיפקט-אטומי-בלי-סודות.
 *
 * דוקטרינה:
 *   · fail-closed — אין מפתח בכספת ⇒ יציאה 2, אפס רשת
 *   · כל קריאת-סוד נרשמת ב-access.log
 *   · אפס-שידור — קריאה בלבד (triggerconstantcontract לא שולח דבר)
 *   · הארטיפקט: כתובת-פומבית + מספרים-מדודים בלבד
 * ───────────────────────────────────────────────────────────────────── */
import { readFileSync, existsSync, appendFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import bs58 from "bs58";

const VAULT = path.join(os.homedir(), ".sovereign", "vault");
const SEED_FILE = path.join(VAULT, "secrets", "STEEM_ACTIVE_WIF");
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "sovereign", "custody", "tron-balance.json");
const CUSTODY = "TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy";
const USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"; // USDT-TRC20 ראשי
const TRONGRID = "https://api.trongrid.io";

if (!existsSync(SEED_FILE)) {
  console.error("tron-balance: STEEM_ACTIVE_WIF לא בכספת — fail-closed, אפס רשת");
  process.exit(2);
}
try {
  appendFileSync(path.join(VAULT, "access.log"), `${new Date().toISOString()} read STEEM_ACTIVE_WIF (tron-balance)\n`, { mode: 0o600 });
} catch {
  /* הלוג לעולם לא חוסם */
}

/* ── עזרי-TRON (זהים-ביט ל-tron-custody r187-A) ── */
function base58check41(payload20: Buffer): string {
  const withPrefix = Buffer.concat([Buffer.from([0x41]), payload20]);
  const checksum = createHash("sha256").update(createHash("sha256").update(withPrefix).digest()).digest().slice(0, 4);
  return bs58.encode(Buffer.concat([withPrefix, checksum]));
}
function decodeAddr20(addr: string): Buffer {
  const decoded = bs58.decode(addr);
  if (decoded.length !== 25 || decoded[0] !== 0x41) throw new Error(`decode fail: ${addr}`);
  if (base58check41(decoded.slice(1, 21)) !== addr) throw new Error(`checksum fail: ${addr}`);
  return Buffer.from(decoded.slice(1, 21));
}

/* ── (1) נגזרת-הכספת: המפתח → כתובת → התאמה-ביט-מול-ביט למשמרת ── */
const wif = readFileSync(SEED_FILE, "utf8").trim();
const GC = await import(path.join(ROOT, "console", "gate-crypto.js"));
const privBytes: Buffer = Buffer.from(await GC.wifToPriv(wif));

/* גזירת-כתובת-TRON מהמפתח הגולמי (keccak של pubkey) — ethers-v6 */
const { ethers } = await import("ethers");
const sk = new ethers.SigningKey(ethers.hexlify(privBytes));
const pubHash = ethers.keccak256("0x" + sk.publicKey.slice(4));
const derived = base58check41(Buffer.from(pubHash.slice(-40), "hex"));
const match = derived === CUSTODY;
console.log(`[derive] ${derived} ${match ? "✓ DERIVATION-MATCH" : "✗ NO-MATCH — עוצרים, אפס רשת"}`);
if (!match) process.exit(3);

/* ── (2) יתרת-TRX חיה ── */
async function fetchTrx(): Promise<{ trx: number | null; exists: boolean }> {
  const res = await fetch(`${TRONGRID}/v1/accounts/${CUSTODY}`, { signal: AbortSignal.timeout(12_000) });
  const j = (await res.json()) as { data?: Array<{ balance?: number }> };
  const acc = j.data?.[0];
  if (!acc) return { trx: 0, exists: false };
  return { trx: (acc.balance ?? 0) / 1e6, exists: true };
}

/* ── (3) יתרת-USDT-TRC20 — triggerconstantcontract (קריאה-טהורה, אפס-שידור) ── */
async function fetchUsdt(): Promise<number | null> {
  const addr20 = decodeAddr20(CUSTODY);
  const token20 = decodeAddr20(USDT_CONTRACT);
  const res = await fetch(`${TRONGRID}/wallet/triggerconstantcontract`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      owner_address: "41" + addr20.toString("hex"),
      contract_address: "41" + token20.toString("hex"),
      function_selector: "balanceOf(address)",
      parameter: addr20.toString("hex").padStart(64, "0"),
      visible: false,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const j = (await res.json()) as { constant_result?: string[]; result?: { result?: boolean | string } };
  const hex = j.constant_result?.[0];
  if (!hex || j.result?.result !== true && j.result?.result !== "SUCCESS") return null;
  return Number(BigInt("0x" + hex)) / 1e6;
}

const at = new Date().toISOString();
let trx: number | null = null;
let usdt: number | null = null;
let exists = false;
let measured = false;
try {
  const t = await fetchTrx();
  trx = t.trx;
  exists = t.exists;
  usdt = await fetchUsdt();
  measured = trx != null;
} catch (e) {
  console.error(`tron-balance: מדידת-רשת נכשלה (${String((e as Error)?.message ?? e).slice(0, 100)}) — נרשם unmeasured`);
}

const verdict = !measured ? "UNMEASURED" : exists ? (trx > 0 ? "MEASURED-FUNDED" : "MEASURED-EMPTY") : "MEASURED-UNACTIVATED";
const artifact = {
  schema: "weave/tron-balance/1",
  at,
  chain: "TRON",
  address: CUSTODY,
  derivedFrom: "STEEM_ACTIVE_WIF (vault) — 32 raw bytes",
  derivationMatch: match,
  accountExistsOnChain: exists,
  liveTrx: trx,
  liveUsdtTrc20: usdt,
  usdtContract: USDT_CONTRACT,
  source: TRONGRID,
  broadcast: "NONE — read-only (D-OP-01 doctrine)",
  verdict,
};
try {
  mkdirSync(path.dirname(OUT), { recursive: true });
  const tmp = `${OUT}.tmp`;
  writeFileSync(tmp, JSON.stringify(artifact, null, 2), { mode: 0o600 });
  renameSync(tmp, OUT);
} catch (e) {
  console.error(`tron-balance: כתיבת-ארטיפקט נכשלה (${String((e as Error)?.message ?? e).slice(0, 80)})`);
}

console.log(`[balance] ${at}`);
console.log(`  TRX  : ${trx ?? "unmeasured"} (account ${exists ? "קיים-על-השרשרת" : "לא-מופעל"})`);
console.log(`  USDT : ${usdt ?? "unmeasured"} (TRC-20)`);
console.log(`[verdict] ${verdict} — ארטיפקט: ${path.relative(ROOT, OUT)}`);
process.exit(measured ? 0 : 1);
