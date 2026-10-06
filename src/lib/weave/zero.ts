// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Zero — מסילת ה-EVM בגז-אפס (G1)
//
// Z Chain (Zero Network, chainId 9369) — רשת EVM ראשית ציבורית חיה
// שבה eth_gasPrice מדוד 0x0. ארנק במאזן אפס חותם טרנזקציות אמיתיות
// מאושרות. לא טסטנט, לא סימולציה, לא ברז — תכנון הרשת עצמה.
//
// הפרוטוקול (העברה נאמנה של anchor-zero.ts מהפלטפורמה, R9 2026-09-12):
//   · שער ה-RPC של הרשת אוכף רשימת-היתר של סלקטורי-calldata:
//     0xa9059cbb (ERC-20 transfer) ו-0x095ea7b3 (approve) עוברים;
//     סלקטורים שרירותיים נדחים (נמדד חי).
//   · לכן: data = קידומת-סלקטור מותרת (4 בתים) + מטען ה-weave הקנוני.
//   · הטרנזקציה ממוענת-עצמית ל-EOA (אין קוד) — אינרטית מבנית;
//     המטען המלא נרשם אימוטבילית על השרשרת.
//
// שרשרת משמרת — זהות החותם היא מפתח הרשת של ה-WEAVE (מה-seal,
// אותו מפתח שחותם checkpoints ב-EIP-712). אימות-עצמי כפול fail-closed:
// הכתובת הנגזרת מהמפתח חייבת להתאים לכתובת שנרשמה ב-seal.
// צורת הפעולה מותרת-כאן-מבנית: נמען = כתובת עצמית, ערך = 0 —
// המודול הזה לעולם לא יכול לחתום העברה, אישור או קריאת חוזה.
//
// שער האפס: ה-gasPrice הנמדד חייב להיות 0; אם הרשת אי-פעם תתחיל
// לגבות — נפילה כנה לשער מאזן×2 (כמו anchor-evm), לעולם לא הנחה.
//
// הוכחת הכללה: receipt.status === 1 + read-back בתים-מדויק של
// ה-data + effectiveGasPrice 0x0 בקבלה. ה-txid מהצומת — לעולם לא
// מומצא. חוקר: zscan.live · RPC: rpc.zero.tech (ציבורי, חסר-מפתחות).
// ─────────────────────────────────────────────────────────────────────

import { ethers } from "ethers";

// ─── קצוות (נמדד חי 2026-09-14: chainId 0x2499 · gasPrice 0x0 · block ~34.7M) ──

export const ZERO_ENDPOINTS = ["https://rpc.zero.tech"] as const;
export const ZERO_CHAIN_ID = 9369; // fail-closed — אין בלבול שרשראות

/** קידומת הסלקטור המותרת שנמדדה (2026-09-12, רשימת-ההיתר של שער ה-RPC) */
export const ZERO_SELECTOR_PREFIX = "0xa9059cbb";

export const ZERO_EXPLORER_TX = "https://zscan.live/tx";
export const ZERO_RAIL_ID = "zero-9369";

/** תקרת גז: EOA→EOA נמדד 21,000–34,680; 300k מכסה מטענים גדולים
 *  יותר על שרשרת שגובהת אפס על זה.
 *  (BigInt(...) במקום ליטרל 300_000n — target ES2017; זהה בזמן ריצה) */
const ZERO_GAS_LIMIT = BigInt(300_000);

// ─── סריאליזציה קנונית (סדר שדות ממוין, בלי float, בלי undefined) ──
// אותה משמעת של canonical-json של הפלטפורמה: דטרמיניסטי, fail-closed.

export function canonicalZeroJson(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (v === null || v === undefined) return null;
    const t = typeof v;
    if (t === "number") {
      if (!Number.isFinite(v) || !Number.isSafeInteger(v)) {
        throw new Error("canonical-zero: float/unsafe integer rejected");
      }
      return v;
    }
    if (t === "bigint") return Number(v);
    if (t === "boolean" || t === "string") return v;
    if (t === "object") {
      const o = v as object;
      if (seen.has(o)) throw new Error("canonical-zero: circular reference rejected");
      seen.add(o);
      if (Array.isArray(o)) return o.map((x) => walk(x === undefined ? null : x));
      const entries = Object.entries(o as Record<string, unknown>)
        .filter(([, val]) => val !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const out: Record<string, unknown> = {};
      for (const [k, val] of entries) out[k] = walk(val);
      return out;
    }
    throw new Error(`canonical-zero: type ${t} rejected`);
  };
  return JSON.stringify(walk(value));
}

// ─── המטען — אותה קונבנציה של קו ה-Steem/Hive + מסילת ה-zero ──

export interface ZeroCheckpointContext {
  at: string;
  repo: string;
  commit: string;
  attestations: number;
  headHash: string;
}

export function buildZeroCheckpointPayload(
  cp: { index: number; root: string; attFrom: number; attTo: number; leafCount: number },
  ctx: ZeroCheckpointContext
): string {
  return canonicalZeroJson({
    protocol: "saos-weave-core/v1",
    action: "checkpoint",
    rail: "zero-evm",
    chainId: ZERO_CHAIN_ID,
    at: ctx.at,
    net: "weave-core",
    repo: ctx.repo,
    checkpoint: cp.index,
    root: cp.root,
    attFrom: cp.attFrom,
    attTo: cp.attTo,
    leaves: cp.leafCount,
    attestations: ctx.attestations,
    headHash: ctx.headHash,
    commit: ctx.commit,
  });
}

export function zeroExplorerLink(txid: string): string {
  return `${ZERO_EXPLORER_TX}/${txid}`;
}

// ─── RPC (חיבורים טריים, batchMaxCount=1 — משמעת נגד זומבים) ──

async function zeroRpc<T>(method: string, params: unknown[]): Promise<{ value: T; endpoint: string }> {
  let lastErr = "no endpoint answered";
  for (const endpoint of ZERO_ENDPOINTS) {
    let provider: ethers.JsonRpcProvider | null = null;
    try {
      provider = new ethers.JsonRpcProvider(endpoint, ZERO_CHAIN_ID, { batchMaxCount: 1 });
      const value = (await provider.send(method, params)) as T;
      provider.destroy();
      return { value, endpoint };
    } catch (e) {
      provider?.destroy();
      lastErr = e instanceof Error ? e.message : "rpc error";
    }
  }
  throw new Error(`zero rpc ${method} failed: ${lastErr}`);
}

// ─── מוכנות — מדידה חיה חסרת-מפתחות (לכל צד שלישי) ──

export interface ZeroReadiness {
  ok: boolean;
  chainId: number | null;
  blockNumber: number | null;
  gasPriceGwei: number | null; // 0 = תכונת האפס, נמדד
  zeroGasConfirmed: boolean;
  balanceEth: string | null; // 0.000000 צפוי כאן — זו הנקודה
  nonce: number | null; // כמה עוגנים חתמנו כבר מהכתובת
  endpoint: string | null;
  verdict: string;
  error?: string;
  at: string;
}

export async function zeroReadiness(address?: string): Promise<ZeroReadiness> {
  const at = new Date().toISOString();
  try {
    const [{ value: chainIdHex, endpoint }, { value: blockHex }, { value: gasWei }] = await Promise.all([
      zeroRpc<string>("eth_chainId", []),
      zeroRpc<string>("eth_blockNumber", []),
      zeroRpc<string>("eth_gasPrice", []),
    ]);
    const chainId = parseInt(String(chainIdHex), 16);
    if (chainId !== ZERO_CHAIN_ID) {
      throw new Error(`chainId gate: node answered ${chainId}, expected ${ZERO_CHAIN_ID} (fail-closed)`);
    }
    const gasPriceWei = BigInt(gasWei);
    const zeroGas = gasPriceWei === BigInt(0);

    let balanceEth: string | null = null;
    let nonce: number | null = null;
    if (address) {
      const [{ value: balanceWei }, { value: nonceHex }] = await Promise.all([
        zeroRpc<string>("eth_getBalance", [address, "latest"]),
        zeroRpc<string>("eth_getTransactionCount", [address, "latest"]),
      ]);
      balanceEth = ethers.formatEther(BigInt(balanceWei)).slice(0, 10);
      nonce = parseInt(String(nonceHex), 16);
    }

    return {
      ok: true,
      chainId,
      blockNumber: parseInt(String(blockHex), 16),
      gasPriceGwei: Number(ethers.formatUnits(gasPriceWei, "gwei")),
      zeroGasConfirmed: zeroGas,
      balanceEth,
      nonce,
      endpoint,
      verdict: zeroGas
        ? `שער-האפס פתוח: gasPrice מדוד 0 — ה-checkpoint יעוגן בטרנזקציה אמיתית בעלות 0.000000`
        : `הרשת כבר לא בגז-אפס (gasPrice ${ethers.formatUnits(gasPriceWei, "gwei")} gwei) — נפילה כנה לשער מאזן×2`,
      at,
    };
  } catch (e) {
    return {
      ok: false,
      chainId: null,
      blockNumber: null,
      gasPriceGwei: null,
      zeroGasConfirmed: false,
      balanceEth: null,
      nonce: null,
      endpoint: null,
      verdict: "readiness failed",
      error: e instanceof Error ? e.message : "readiness failed",
      at,
    };
  }
}

// ─── השופט החיצוני — מדידת גובה חיה חסרת-מפתחות ──
//
// שוק האמת מרחיב את סוגי השופטים שלו: מעבר ל-DB של הרשת עצמה,
// מטרת "zero-block-height" נמדדת מהשרשרת הציבורית החיצונית עצמה
// (Z Chain 9369) — קריאת RPC ציבורית בלי מפתח, בלי כסף, ב-$0.
// אותו fail-closed של כל הקו: שער chainId נוקשה, מספר שלם בטוח.

/** קצב הבלוקים שנמדד (2026-09-14: 4 בלוקים ב-10 שניות) — לרמזי UI בלבד */
export const ZERO_BLOCK_SECONDS_MEASURED = 2.5;

/** פער מינימלי מהגובה הנוכחי לפתיחת שוק (120 בלוקים ≈ 5 דקות) —
 *  הטענה חייבת להיות עתידית-ממשית, לא מרוץ-מילי-שניות */
export const ZERO_MIN_TARGET_GAP = 120;

export interface ZeroHeightMeasurement {
  chainId: number;
  height: number;
  measuredAt: string;
  endpoint: string;
}

// מטמון קצר (15ש') — השופט נקרא בכל GET של השוק ובכל מדידת מועמד;
// הגובה מתקדם בבלוק ל-2.5 שניות, כך שהטריות נשמרת בסדר גודל של
// התקדמות השרשרת עצמה.
let zeroHeightCache: { at: number; value: ZeroHeightMeasurement } | null = null;
const ZERO_HEIGHT_TTL_MS = 15_000;

export async function zeroBlockHeight(): Promise<ZeroHeightMeasurement> {
  if (zeroHeightCache && Date.now() - zeroHeightCache.at < ZERO_HEIGHT_TTL_MS) {
    return zeroHeightCache.value;
  }
  const [{ value: chainIdHex, endpoint }, { value: blockHex }] = await Promise.all([
    zeroRpc<string>("eth_chainId", []),
    zeroRpc<string>("eth_blockNumber", []),
  ]);
  const chainId = parseInt(String(chainIdHex), 16);
  if (chainId !== ZERO_CHAIN_ID) {
    throw new Error(`chainId gate: node answered ${chainId}, expected ${ZERO_CHAIN_ID} (fail-closed)`);
  }
  const height = parseInt(String(blockHex), 16);
  if (!Number.isSafeInteger(height) || height <= 0) {
    throw new Error(`eth_blockNumber malformed: ${String(blockHex)}`);
  }
  const value: ZeroHeightMeasurement = { chainId, height, measuredAt: new Date().toISOString(), endpoint };
  zeroHeightCache = { at: Date.now(), value };
  return value;
}

// ─── העיגון החי — הפעולה המותרת-מבנית ──

export interface ZeroAnchorOutcome {
  ok: boolean;
  network: "ZERO";
  chainId: number;
  account: string;
  checkpoint: number;
  root: string;
  payload: string;
  dataHex: string; // הסלקטור + המטען — הבתים המדויקים על השרשרת
  txid: string | null;
  block: number | null;
  confirmed: boolean; // receipt.status===1 && read-back בתים-מדויק
  gasUsed: number | null;
  effectiveGasPrice: string | null; // 0x0 בקבלה — הוכחת האפס
  costEth: string | null; // "0.000000" — נמדד, לא מונח
  explorer: string | null;
  at: string;
  error?: string;
}

export async function anchorOnZero(params: {
  cp: { index: number; root: string; attFrom: number; attTo: number; leafCount: number };
  networkKeyHex: string;
  expectedAddress: string; // מה-seal — אימות-עצמי כפול fail-closed
  ctx: ZeroCheckpointContext;
}): Promise<ZeroAnchorOutcome> {
  const { cp, networkKeyHex, expectedAddress, ctx } = params;
  const at = ctx.at;
  const payload = buildZeroCheckpointPayload(cp, ctx);
  const dataHex = ZERO_SELECTOR_PREFIX + Buffer.from(payload, "utf8").toString("hex");

  // אימות-עצמי fail-closed: הנגזרת מהמפתח === הכתובת שנרשמה ב-seal
  const wallet = new ethers.Wallet(networkKeyHex);
  if (wallet.address.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error(
      `zero self-verify FAILED: derived ${wallet.address} ≠ sealed ${expectedAddress} — refusing to sign`
    );
  }

  const provider = new ethers.JsonRpcProvider(ZERO_ENDPOINTS[0], ZERO_CHAIN_ID, { batchMaxCount: 1 });
  let hash: string;
  try {
    // שערים חיים — נמדדים, לא מונחים
    const [gasWei, chainIdHex] = await Promise.all([
      provider.send("eth_gasPrice", []),
      provider.send("eth_chainId", []),
    ]);
    const chainId = parseInt(String(chainIdHex), 16);
    if (chainId !== ZERO_CHAIN_ID) {
      throw new Error(`chainId gate: ${chainId} ≠ ${ZERO_CHAIN_ID} (fail-closed)`);
    }
    const gasPriceWei = BigInt(gasWei);
    let pricedGas = BigInt(0);
    if (gasPriceWei > BigInt(0)) {
      // נפילה כנה — הרשת התחילה לגבות: אותו שער מאזן×2 של anchor-evm
      const balanceWei = await provider.getBalance(wallet.address, "latest");
      const costWei = ZERO_GAS_LIMIT * gasPriceWei;
      if (balanceWei < costWei * BigInt(2)) {
        throw new Error(
          `zero-gas property lost: gasPrice ${ethers.formatUnits(gasPriceWei, "gwei")} gwei and balance ${ethers.formatEther(balanceWei)} ETH < cost×2 — the anchor did not fire (honest)`
        );
      }
      pricedGas = gasPriceWei;
    }

    // הפעולה המותרת-מבנית — ממוענת-עצמית, ערך 0, סלקטור+weave
    const signer = new ethers.Wallet(wallet.privateKey, provider);
    const tx = await signer.sendTransaction({
      to: wallet.address,
      value: BigInt(0),
      data: dataHex,
      gasLimit: ZERO_GAS_LIMIT,
      gasPrice: pricedGas, // 0 על שרשרת האפס — נמדד למעלה
      type: 0,
      chainId: ZERO_CHAIN_ID,
    });
    hash = tx.hash;
  } catch (e) {
    provider.destroy();
    throw e;
  }

  // הוכחת הכללה — קבלה + read-back מלא של ה-data
  const receipt = await waitForReceipt(provider, hash);
  let confirmed = false;
  let gasUsed: number | null = null;
  let block: number | null = null;
  let effectiveGasPrice: string | null = null;
  if (receipt) {
    block = receipt.blockNumber;
    gasUsed = Number(receipt.gasUsed);
    effectiveGasPrice = receipt.gasPrice?.toString() ?? null;
    const txOnChain = await provider.getTransaction(hash).catch(() => null);
    confirmed = receipt.status === 1 && !!txOnChain && txOnChain.data.toLowerCase() === dataHex.toLowerCase();
  }
  provider.destroy();

  const costEth =
    receipt && effectiveGasPrice !== null
      ? ethers.formatEther((receipt.gasUsed * BigInt(effectiveGasPrice)))
      : null;

  return {
    ok: true,
    network: "ZERO",
    chainId: ZERO_CHAIN_ID,
    account: wallet.address,
    checkpoint: cp.index,
    root: cp.root,
    payload,
    dataHex,
    txid: hash,
    block,
    confirmed,
    gasUsed,
    effectiveGasPrice,
    costEth,
    explorer: zeroExplorerLink(hash),
    at,
  };
}

// ─── קריאה-חזרה חסרת-מפתחות — כל צד שלישי מאמת מה-RPC הציבורי ──
// לקח הצי (Task 9): איחור אינדקס של הצומת נתפס בניסיון-חוזר, לא מוכרז
// ככישלון — החיבורים המקבילים מאחורי ה-RPC עשויים להיות בלתי-עקביים
// בחלון של שניות אחרי ההכללה. נמדד: הקבלה קיימת אצל צומת א'
// ועדיין null אצל צום ב' — הוכחה, לא כישלון.

export interface ZeroReadback {
  ok: boolean;
  txid: string;
  found: boolean;
  status: number | null;
  block: number | null;
  from: string | null;
  to: string | null;
  dataMatches: boolean; // ה-data על השרשרת === הסלקטור+המטען שנשלח
  effectiveGasPrice: string | null;
  gasUsed: number | null;
  inputHex: string | null; // ה-calldata המלא כפי שנקרא מהשרשרת
  payload: Record<string, unknown> | null; // המטען הקנוני מפוענח מהשרשרת
  verdict: string;
  at: string;
}

export async function verifyZeroAnchorOnChain(
  txid: string,
  expectedDataHex?: string,
  attempts: number = 4
): Promise<ZeroReadback> {
  let last: ZeroReadback | null = null;
  for (let i = 0; i < attempts; i++) {
    last = await verifyZeroAnchorOnce(txid, expectedDataHex);
    if (last.found) return last;
    // חלון פיגור-האינדקס — עוד ניסיון אחרי המתנה, לפני הכרזת NOT-FOUND
    if (i < attempts - 1) await sleep(3000);
  }
  // attempts≥1 מובטח מברירת-המחדל (4); הלולאה מילאה תמיד את last.
  return last as ZeroReadback;
}

/** פענוח המטען הקנוני מה-calldata שעל השרשרת — סלקטור + JSON */
export function decodeZeroInput(inputHex: string): Record<string, unknown> | null {
  try {
    if (!inputHex.toLowerCase().startsWith(ZERO_SELECTOR_PREFIX)) return null;
    const payload = Buffer.from(inputHex.slice(10), "hex").toString("utf8");
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function verifyZeroAnchorOnce(txid: string, expectedDataHex?: string): Promise<ZeroReadback> {
  const at = new Date().toISOString();
  const provider = new ethers.JsonRpcProvider(ZERO_ENDPOINTS[0], ZERO_CHAIN_ID, { batchMaxCount: 1 });
  try {
    const [receipt, tx] = await Promise.all([
      provider.getTransactionReceipt(txid).catch(() => null),
      provider.getTransaction(txid).catch(() => null),
    ]);
    if (!receipt || !tx) {
      return { ok: false, txid, found: false, status: null, block: null, from: null, to: null, dataMatches: false, effectiveGasPrice: null, gasUsed: null, inputHex: null, payload: null, verdict: "NOT-FOUND (node blind or wrong txid)", at };
    }
    const inputHex = tx.data ?? "0x";
    const dataMatches = expectedDataHex ? inputHex.toLowerCase() === expectedDataHex.toLowerCase() : true;
    const payload = decodeZeroInput(inputHex);
    const effGas = receipt.gasPrice?.toString() ?? null;
    const verdict =
      receipt.status === 1 && dataMatches
        ? effGas === "0"
          ? "ON-CHAIN · status 1 · data byte-exact · effectiveGasPrice 0x0 — the zero anchor is proven"
          : `ON-CHAIN · status 1 · data byte-exact · effectiveGasPrice ${effGas} (chain no longer zero-gas)`
        : receipt.status === 1
          ? "ON-CHAIN but data mismatch — payload drift"
          : "ON-CHAIN but status failed";
    return {
      ok: receipt.status === 1 && dataMatches,
      txid,
      found: true,
      status: receipt.status,
      block: receipt.blockNumber,
      from: tx.from,
      to: tx.to,
      dataMatches,
      effectiveGasPrice: effGas,
      gasUsed: Number(receipt.gasUsed),
      inputHex,
      payload,
      verdict,
      at,
    };
  } finally {
    provider.destroy();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForReceipt(
  provider: ethers.JsonRpcProvider,
  hash: string,
  timeoutMs = 60_000
): Promise<ethers.TransactionReceipt | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const receipt = await provider.getTransactionReceipt(hash).catch(() => null);
    if (receipt) return receipt;
    await sleep(2500);
  }
  return null;
}
