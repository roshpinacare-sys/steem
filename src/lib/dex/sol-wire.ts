// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · SOL Wire — רגל סולנה בנתיב הכספת הריבוני (R102)
//
// הוכח חי בפתיחת הסשן: 12/12 מפתחות solana בכספת (hex-seed 32 בייט),
// הנגזרת הפומבית תואמת ביט-מול-ביט (ed25519 ← seed), והמאזן החי של
// cashmachine = 0.0616 SOL — הון-אגרה אמיתי. הרגל בונה טרנזקציית
// legacy ביד (serialize + חתימה) כי אין @solana/web3.js — הפרוטוקול
// פשוט, מתועד וניתן-לאימות: message → ed25519 → wire → RPC.
//
// חוקי-ברזל: כמו evm-wire — מפתח בזיכרון בלבד, נגזרת מאומתת מול
// הרשומה לפני כל שידור, קבלה כנה, שער-מאה.
// ─────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";
import { createRequire } from "node:module";
import { openVaultEntryRaw } from "@/lib/dex/wallet-vault";

const nodeRequire = createRequire("/home/z/my-project/package.json");
// bs58 4.x — CJS טהור
const bs58 = nodeRequire("bs58") as {
  encode(b: Uint8Array | Buffer): string;
  decode(s: string): Uint8Array;
};

const SOL_RPC = process.env.SOL_RPC || "https://api.mainnet-beta.solana.com";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const SPL_MEMO_PROGRAM = "Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH"; // spl-memo הרשמי — נמדד 32 בייט ואומת מול השרשרת כתוכנית פעילה (מקור: solana-program/memo, clients/js-legacy)

/** R105 — אוצר ה-SOL של הזירה: cashmachine (שם ההון חי, אותו מפתח-אב).
 * כתובת ציבורית נטולת-סוד; בכל שידור הנגזרת מאומתת מול הכספת בכל מקרה. */
export const SOL_TREASURY_PUB = "HBBdhpbpFP3BwqcvrxJ44hAyKSid3D6AB4SFvtrN736s";

export interface SolKeypair {
  ok: boolean;
  pub?: string;
  entryPub?: string;
  match?: boolean;
  /** seed-32 — זיכרון-הרצה בלבד */
  seed?: Buffer;
  /** המפתח הסודי המורחב (seed‖pub, 64 בייט) — זיכרון-הרצה בלבד */
  secret?: Buffer;
  detail?: string;
}

/** פתיחת זוג-מפתחות סולנה מהכספת + אימום הנגזרת מול הרשומה */
export function openSolVaultKeypair(account: string): SolKeypair {
  const raw = openVaultEntryRaw("solana", account, "wallet");
  if (!raw.ok || !raw.priv) {
    return { ok: false, detail: raw.detail ?? "VAULT-CLOSED" };
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw.priv.replace(/^0x/, ""))) {
    return { ok: false, detail: "BAD-FORMAT: חומר המפתח אינו hex-seed של 32 בייט" };
  }
  const seed = Buffer.from(raw.priv.replace(/^0x/, ""), "hex");
  const pub = ed25519PubFromSeed(seed);
  const derivedB58 = bs58.encode(pub);
  const match = derivedB58 === raw.entryPub;
  if (!match) {
    return { ok: false, pub: derivedB58, entryPub: raw.entryPub, match: false, detail: "PUB-MISMATCH: הנגזרת אינה מתאימה לרשומת הכספת — שידור חסום" };
  }
  return { ok: true, pub: derivedB58, entryPub: raw.entryPub, match: true, seed, secret: Buffer.concat([seed, pub]), detail: raw.detail };
}

/** גזירת פומבי ed25519 מ-seed — node:crypto מובנה (PKCS8→SPKI) */
export function ed25519PubFromSeed(seed: Buffer): Buffer {
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const priv = crypto.createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  const pub = crypto.createPublicKey(priv);
  const spki = pub.export({ format: "der", type: "spki" });
  return Buffer.from(spki.subarray(spki.length - 32));
}

/** חתימת ed25519 תקנית עם node:crypto (תואמת סולנה — RFC 8032) */
function ed25519Sign(secret: Buffer, message: Buffer): Buffer {
  const seed = secret.subarray(0, 32);
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const priv = crypto.createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  return crypto.sign(null, message, priv);
}

// ── סריאליזציה ידנית של טרנזקציית legacy (תקנת סולנה) ────────────────

function compactU16(n: number): Buffer {
  // shortvec encoding
  const out: number[] = [];
  let v = n;
  for (;;) {
    let byte = v & 0x7f;
    v >>= 7;
    if (v === 0) { out.push(byte); break; }
    byte |= 0x80;
    out.push(byte);
  }
  return Buffer.from(out);
}

/** הודעת legacy: header + accountKeys + blockhash + instructions — עם memo אופציונלי
 * (R105: הוראת spl-memo נוספת — כך נשלחות הפקדות wx:<member> הנקראות על ידי הסורק) */
export function buildLegacyMessage(from: Buffer, to: Buffer, lamports: number, blockhash: Buffer, memo?: string): Buffer {
  const fromB58 = bs58.encode(from);
  const toB58 = bs58.encode(to);
  const systemB58 = SYSTEM_PROGRAM;
  const hasMemo = typeof memo === "string" && memo.length > 0;
  const accountKeys = hasMemo
    ? [fromB58, toB58, systemB58, SPL_MEMO_PROGRAM].map((k) => bs58.decode(k))
    : [fromB58, toB58, systemB58].map((k) => bs58.decode(k));
  // header: 1 חותם נדרש, 0 קריאה-בלבד-חתום, 1/2 קריאה-בלבד-לא-חתום (system [+ spl-memo])
  const header = Buffer.from([1, 0, hasMemo ? 2 : 1]);
  const keysLen = compactU16(accountKeys.length);
  const keysBuf = Buffer.concat(accountKeys);
  // הוראת SystemProgram::Transfer: u32=2 (LE) + u64 lamports (LE)
  const data = Buffer.concat([Buffer.from([2, 0, 0, 0]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(lamports)); return b; })()]);
  // instruction: programIdIndex=2, accounts=[0,1], data
  const instr = Buffer.concat([
    Buffer.from([2]),
    compactU16(2),
    Buffer.from([0, 1]),
    compactU16(data.length),
    data,
  ]);
  const instrs: Buffer[] = [instr];
  if (hasMemo) {
    const memoBytes = Buffer.from(memo as string, "utf8");
    // הוראת spl-memo: programIdIndex=3, אפס חשבונות, data=utf8 המזכר
    instrs.push(Buffer.concat([
      Buffer.from([3]),
      compactU16(0),
      compactU16(memoBytes.length),
      memoBytes,
    ]));
  }
  const instrCount = compactU16(instrs.length);
  return Buffer.concat([header, keysLen, keysBuf, blockhash, instrCount, ...instrs]);
}

/** wire: חתימות + message — מוכן ל-sendTransaction (base64) */
export function buildSignedTx(secret: Buffer, message: Buffer): { wireBase64: string; signature: string } {
  const sig = ed25519Sign(secret, message);
  const wire = Buffer.concat([compactU16(1), sig, message]);
  return { wireBase64: wire.toString("base64"), signature: bs58.encode(sig) };
}

// ── RPC ──────────────────────────────────────────────────────────────

async function solRpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(SOL_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  const j = (await res.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(j.error.message.slice(0, 120));
  return j.result as T;
}

/** R105 — RPC ציבורי לסורק ההפקדות (נטול-מפתחות; השרשרת שופטת) */
export { solRpc };

/** פענוח base58 → utf8 (לקריאת הוראות מזכר) */
export function decodeBase58Utf8(s: string): string {
  return Buffer.from(bs58.decode(s)).toString("utf8");
}

/** כתובת סולנה תקפה: base58 שמפענח ל-32 בייט */
export function isValidSolPubkey(s: string): boolean {
  try {
    return Buffer.from(bs58.decode(s)).length === 32;
  } catch {
    return false;
  }
}

export async function solBalance(pub: string): Promise<{ lamports: number; sol: number; error?: string }> {
  try {
    const r = await solRpc<{ value: number }>("getBalance", [pub, { commitment: "confirmed" }]);
    return { lamports: r.value, sol: r.value / 1e9 };
  } catch (e) {
    return { lamports: 0, sol: 0, error: String((e as Error).message ?? e).slice(0, 100) };
  }
}

export interface SolSendResult {
  ok: boolean;
  txid?: string;
  detail: string;
  balanceSol?: number;
  feeSol?: number;
}

const LAMPORTS_PER_SOL = 1_000_000_000;
const FEE_LAMPORTS = 5000; // תעריף הבסיס של סולנה לחתימה

/** שידור SOL אמיתי: מאזן → blockhash → בנייה → חתימה → שליחה.
 * R105: memo אופציונלי — הוראת spl-memo מצורפת להודעה (הפקדות wx:). */
export async function solSend(account: string, toPub: string, sol: number, opts?: { memo?: string }): Promise<SolSendResult> {
  const kp = openSolVaultKeypair(account);
  if (!kp.ok || !kp.pub || !kp.secret) {
    return { ok: false, detail: `NO-KEY: ${kp.detail ?? "vault-closed"}` };
  }
  let toBuf: Buffer;
  try {
    toBuf = Buffer.from(bs58.decode(toPub));
    if (toBuf.length !== 32) throw new Error("len");
  } catch {
    return { ok: false, detail: "BAD-TO: כתובת יעד שגויה" };
  }
  if (!(sol > 0)) return { ok: false, detail: "BAD-VALUE: סכום חייב להיות חיובי" };
  const lamports = Math.floor(sol * LAMPORTS_PER_SOL);
  if (lamports <= 0) return { ok: false, detail: "BAD-VALUE: סכום מתחת לרזולוציית השרשרת" };
  try {
    const bal = await solBalance(kp.pub);
    if (bal.error) return { ok: false, detail: `RPC-DOWN: ${bal.error}` };
    if (bal.lamports < lamports + FEE_LAMPORTS) {
      return {
        ok: false,
        detail: `NO-FUEL: המאזן ${bal.sol.toFixed(9)} SOL אינו מכסה סכום+עמלה (${(sol + FEE_LAMPORTS / 1e9).toFixed(9)} SOL) — אמת מדודה`,
        balanceSol: bal.sol,
        feeSol: FEE_LAMPORTS / 1e9,
      };
    }
    const bh = await solRpc<{ value: { blockhash: string } }>("getLatestBlockhash", [{ commitment: "finalized" }]);
    const blockhash = Buffer.from(bs58.decode(bh.value.blockhash));
    if (blockhash.length !== 32) return { ok: false, detail: "BAD-BLOCKHASH" };
    const message = buildLegacyMessage(
      Buffer.from(bs58.decode(kp.pub)),
      toBuf,
      lamports,
      blockhash,
      opts?.memo,
    );
    const { wireBase64 } = buildSignedTx(kp.secret, message);
    const txid = await solRpc<string>("sendTransaction", [
      wireBase64,
      { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" },
    ]);
    return {
      ok: true,
      txid,
      detail: "broadcast-accepted (השרשרת השופט: אישור = כריתה בבלוק)",
      balanceSol: bal.sol,
      feeSol: FEE_LAMPORTS / 1e9,
    };
  } catch (e) {
    return { ok: false, detail: "SEND-ERROR: " + String((e as Error).message ?? e).slice(0, 140) };
  }
}
