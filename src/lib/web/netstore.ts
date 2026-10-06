// ─────────────────────────────────────────────────────────────────────
// SAOS WEB · netstore v2 — רשת-האחסון הריבונית: השרשרת הציבורית כאמת.
//
// דוקטרינה (פקודת המפעיל, R50): "האמת היא האימות של השרת על הרשת."
// שכבת האחסון (נמדד בפועל, probe1/probe2 2026-09-19):
//   · Steem custom_json — המסלול החי: בסיס ~65M RC + ~320k RC לתו.
//   · Steem comment — בסיס 976M RC — מסלול מת (מדידה קשה, כנה).
//   · Hive — 509k/תו, יקר יותר. רשת-ביטחון לחותם.
//
// שורשות שנמצאו ורופאו ב-R51 (הכל נמדד חי):
//   · ל-Steem יש מגבלת 100 רשומות לקריאת היסטוריה (upper limit is 100)
//     — הקוד הישן ביקש 1,000 והסריקה נכשלה בשקט. מעתה: עימוד
//     chain-aware (Steem 100 · Hive 1,000).
//   · לחשבון 36,894 רשומות ב-Steem — חלון סריקה קטן מאבד את העבר.
//     מעתה: סריקה-עמוקה בתקציב-רשומות + קריאות-בלוק ממוקדות
//     (block_api.get_block) מכתובות בלוק שרשומת-הריפו מכירה —
//     איתור החותם והצ׳אנקים בכל עומק היסטוריה. הבלוק עצמו הוא
//     אמת-שרשרת; רשומת הריפו רק מצביעה לאן להסתכל.
//
// מבנה על השרשרת (חשבון העוגן cashmachine, סמכות posting בלבד):
//   · חותם: custom_json id=saos.web.v1 {name, sha256, bytes, mime, entry,
//     s(b64len), at} — הולך ראשון.
//   · צ׳אנקים: custom_json id=saos.web.c.v1 {h, i, d} — הבייטים עצמם,
//     בגודל אדפטיבי לפי המנה החיה. מצטבר עד שלמות (join ⇒ s ⇒ sha256).
//
// הגשה (השרת של הרשת): קודם צ׳אנקים מהשרשרת; מה שטרם הגיע מגיע
// מהעותק בריפו הריבוני (sovereign/web/packages/<hash>.bin) — אבל
// רק לאחר שה-sha256 שלו נבדק מול החותם שעל השרשרת.
//
// כל פונקציה כאן נטולת-מפתח: קריאה ואימות בלבד. השידור חי בענן
// (scripts/web-publish.ts + web-publish.yml) אצל WEAVE_STEEM_WIF.
// ─────────────────────────────────────────────────────────────────────

import { createHash } from "crypto";
import { deflateRawSync, inflateRawSync } from "zlib";
import { readFile } from "fs/promises";
import path from "path";
import {
  STEEM_RPC_NODES,
  HIVE_RPC,
  rpcV4,
  type DynamicGlobalProperties,
} from "@/lib/weave/graphene";

// ── קבועים ──────────────────────────────────────────────────────────

export const WEB_TAG = "saosweb";
export const WEB_OP_ID = "saos.web.v1";
export const WEB_CHUNK_OP_ID = "saos.web.c.v1";
export const WEB_PROTOCOL = "saos-web/1";
export const WEB_ACCOUNT = (process.env.WEB_STEEM_ACCOUNT || "cashmachine").toLowerCase();

/**
 * מודל המחיר הנלמד מהשרשרת (probe2, 2026-09-19, נטוי-מדידות):
 *   1,000 תווים = 404M RC · 2,000 = 725M · 4,000 = 1,365M
 *   ⇒ בסיס ~65M + ~320k לתו. מרווח בטיחות 1.15 על האומדן.
 */
export const RC_MODEL = {
  base: 65_000_000,
  perChar: 320_000,
  reserve: 20_000_000,
  margin: 1.15,
  /** תקרת-תווים לצ׳אנק בודד — נמדר בפועל עד 4,000; 6,500 נבחר ב-R50 כמרווח */
  chunkCharsMax: 6_500,
  chunkCharsMin: 500,
} as const;

/**
 * תקציבי-סריקה ברשומות. העימוד chain-aware (נמדד חי 2026-09-19):
 * Steem מגבה את condenser_api.get_account_history ל-100 רשומות;
 * Hive מרשה 1,000. הסריקה מתגלגלת אחורה עד לתקציב או קצה ההיסטוריה.
 */
const SCAN_PAGE_STEEM = 100;
const SCAN_PAGE_HIVE = 1_000;
/** נתיב-הגשה: 600 רשומות אחרונות (צ׳אנקים טריים) + השלמה ממוקדת-בלוק */
const SCAN_ENTRIES_SERVE = 600;
/** מנוע-ההוכחות: 2,000 רשומות כברירת-מחדל; ?entries= עד 30,000 */
const SCAN_ENTRIES_VERIFY = 2_000;
const SCAN_ENTRIES_MAX = 30_000;
const SCAN_CACHE_TTL_MS = 60_000;

// ── טיפוסים ─────────────────────────────────────────────────────────

export interface WebChunk {
  i: number;
  chars: number;
  block?: number | null;
  txid?: string | null;
}

export interface WebManifest {
  v: 1;
  protocol: "saos-web/1";
  name: string;
  sha256: string;
  bytes: number;
  mime: string;
  entry?: string;
  b64len: number;
  chunkSize: number; // 0 = אדפטיבי
  mode: "chunks";
  by: string;
  at: string;
}

export interface WebManifestRecord {
  manifest: WebManifest;
  status: "pending-seal" | "partial" | "complete";
  chain: {
    manifestOp?: { block?: number | null; txid?: string | null } | null;
    chunks?: WebChunk[];
  };
  inboxJob?: {
    id: string;
    name: string;
    sha256: string;
    bytes: number;
    mime: string;
    entry?: string;
    status: string;
    createdAt: string;
    attempts?: number;
    lastNote?: string;
  };
  publishedBy?: string;
  verifiedAt?: string;
  note?: string;
}

export interface WebInboxJob {
  id: string;
  name: string;
  sha256: string;
  bytes: number;
  mime: string;
  entry?: string;
  status: "pending" | "uploading" | "done";
  createdAt: string;
  attempts?: number;
  lastNote?: string;
}

// ── עזרים ───────────────────────────────────────────────────────────

export function sha256Hex(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function looksLikeSha256(hash: string): boolean {
  return /^[0-9a-f]{64}$/.test(hash);
}

/** RPC ציבורי עם ניסיון חלופה בין צמתים */
async function steemRpc<T>(method: string, params: unknown, timeoutMs = 20_000): Promise<T | null> {
  let lastErr: unknown = null;
  for (const node of STEEM_RPC_NODES) {
    try {
      return await rpcV4<T>(node, method, params, timeoutMs);
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw new Error(`steem-rpc-unreachable: ${String(lastErr).slice(0, 120)}`);
  return null;
}

async function hiveRpc<T>(method: string, params: unknown, timeoutMs = 20_000): Promise<T | null> {
  return rpcV4<T>(HIVE_RPC, method, params, timeoutMs).catch(() => null);
}

// ── קריאת-בלוק ממוקדת — אמת-שרשרת בכל עומק ─────────────────────────────
//
// block_api.get_block מחזיר את הבלוק עצמו: האופרציות בצורת
// {type:"custom_json_operation", value:{id, json, required_posting_auths}}
// (נמדד חי בשתי השרשראות). רשומת-הריפו מספקת כתובות-בלוק; הבלוק
// עצמו הוא האמת — רשומה שגויה פשוט לא תמצא את מה שחיפשנו בו.

interface BlockWebOp {
  id: string;
  json: string;
  txid: string;
}

/** גוף הבלוק כפי ש-appbase/condenser מחזירים (טיפוס שם — לא typeof מקומי,
 *  שמנטרל את היצוק-הזרימה של block בהמשך הפונקציה) */
interface ChainBlock {
  transactions?: Array<{
    transaction_id?: string;
    operations?: Array<unknown>;
  }>;
}

async function readWebOpsFromBlock(chain: "steem" | "hive", blockNum: number): Promise<BlockWebOp[]> {
  let block: ChainBlock | null = null;
  try {
    const res = chain === "steem"
      ? await steemRpc<{ block?: ChainBlock }>("block_api.get_block", { block_num: blockNum })
      : await hiveRpc<{ block?: ChainBlock }>("block_api.get_block", { block_num: blockNum });
    block = res?.block ?? null;
  } catch {
    return [];
  }
  if (!block?.transactions) return [];
  const out: BlockWebOp[] = [];
  for (const tx of block.transactions) {
    for (const op of tx.operations ?? []) {
      // שתי צורות נצפו בפועל: dict (appbase) ו-array (condenser) — מקבלים את שתיהן
      let id: string | undefined;
      let json: string | undefined;
      if (Array.isArray(op) && op[0] === "custom_json") {
        id = (op[1] as { id?: string })?.id;
        json = (op[1] as { json?: string })?.json;
      } else if (op && typeof op === "object") {
        const o = op as { type?: string; value?: { id?: string; json?: string } };
        if (o.type === "custom_json_operation" && o.value) {
          id = o.value.id;
          json = o.value.json;
        }
      }
      if (id && (id === WEB_OP_ID || id === WEB_CHUNK_OP_ID) && json) {
        out.push({ id, json, txid: tx.transaction_id || "" });
      }
    }
  }
  return out;
}

/** רשומת-הריפו של חבילה — מצביע-דרך בלבד; הבלוק הוא השופט */
async function readRepoRecord(hash: string): Promise<WebManifestRecord | null> {
  try {
    const p = path.join(process.cwd(), "sovereign", "web", "manifests", `${hash}.json`);
    return JSON.parse(await readFile(p, "utf8")) as WebManifestRecord;
  } catch {
    return null;
  }
}

/** החותם מכתובת-בלוק שרשומת-הריפו מכירה — Steem ואז Hive */
async function sealFromRepoHint(hash: string): Promise<(WebManifest & { chain: "steem" | "hive"; block: number; txid: string }) | null> {
  const rec = await readRepoRecord(hash);
  const blockNum = rec?.chain?.manifestOp?.block;
  if (!rec || typeof blockNum !== "number" || blockNum <= 0) return null;
  for (const chain of ["steem", "hive"] as const) {
    const ops = await readWebOpsFromBlock(chain, blockNum);
    for (const op of ops) {
      if (op.id !== WEB_OP_ID) continue;
      try {
        const pl = JSON.parse(op.json) as Record<string, unknown>;
        if (String(pl.sha256 || "") !== hash) continue;
        return {
          v: 1,
          protocol: WEB_PROTOCOL,
          name: String(pl.name || ""),
          sha256: hash,
          bytes: Number(pl.bytes || 0),
          mime: String(pl.mime || "application/octet-stream"),
          entry: pl.entry ? String(pl.entry) : undefined,
          b64len: Number(pl.s || 0),
          chunkSize: 0,
          mode: "chunks",
          by: WEB_ACCOUNT,
          at: String(pl.at || ""),
          chain,
          block: blockNum,
          txid: op.txid,
        };
      } catch {
        /* json זר */
      }
    }
  }
  return null;
}

// ── הסריקה העמוקה — השרשרת מה יש עליה ─────────────────────────────────

export interface WebScanMeta {
  chain: "steem" | "hive";
  pagesScanned: number;
  entriesScanned: number;
  /** סך-כל הרשומות בהיסטוריית החשבון כפי שנמדד מהאינדקס המוחלט של הרשומה החדשה */
  entriesTotal: number | null;
  /** האם הסריקה הגיעה לקצה ההיסטוריה (אמת-מלאה) או נעצרה בתקציב */
  reachedBeginning: boolean;
  scannedAt: string;
}

export interface ChainChunkRaw {
  i: number;
  d: string;
  chars: number;
  block?: number;
  txid?: string;
}

export interface ChainHashEntry {
  manifest: (WebManifest & { block?: number; txid?: string }) | null;
  manifestChain?: "steem" | "hive";
  chunks: Map<number, ChainChunkRaw>;
}

export interface DeepScanResult {
  meta: WebScanMeta;
  byHash: Map<string, ChainHashEntry>;
}

interface HistEntry {
  op?: [string, { id?: string; json?: string }];
  trx_id?: string;
  block?: number;
}

const scanCache = new Map<"steem" | "hive", { at: number; entries: number; res: DeepScanResult }>();
// רענון-רקע single-flight לכל שרשרת + backoff משותף (לא להציף צומת)
const scanBgInflight = new Map<"steem" | "hive", Promise<void>>();
let scanBgNextKickAt = 0;

function emptyHashEntry(): ChainHashEntry {
  return { manifest: null, chunks: new Map() };
}

function ingestHistOp(byHash: Map<string, ChainHashEntry>, e: HistEntry, account: string): void {
  const op = e.op;
  if (!op || op[0] !== "custom_json") return;
  const id = op[1].id;
  if (id !== WEB_OP_ID && id !== WEB_CHUNK_OP_ID) return;
  try {
    const pl = JSON.parse(String(op[1].json || "{}")) as Record<string, unknown>;
    if (id === WEB_OP_ID) {
      const h = String(pl.sha256 || "");
      if (!h) return;
      const entry = byHash.get(h) ?? emptyHashEntry();
      entry.manifest = {
        v: 1,
        protocol: WEB_PROTOCOL,
        name: String(pl.name || ""),
        sha256: h,
        bytes: Number(pl.bytes || 0),
        mime: String(pl.mime || "application/octet-stream"),
        entry: pl.entry ? String(pl.entry) : undefined,
        b64len: Number(pl.s || 0),
        chunkSize: 0,
        mode: "chunks",
        by: account,
        at: String(pl.at || ""),
        block: e.block,
        txid: e.trx_id,
      };
      entry.manifestChain = undefined;
      byHash.set(h, entry);
    } else if (typeof pl.h === "string" && typeof pl.i === "number" && typeof pl.d === "string") {
      const entry = byHash.get(pl.h) ?? emptyHashEntry();
      // דה-דופליקציה: אותו אינדקס פעמיים ⇒ הראשון שנצפה שורד (היסטוריה עולה)
      if (!entry.chunks.has(pl.i)) {
        entry.chunks.set(pl.i, { i: pl.i, d: pl.d, chars: pl.d.length, block: e.block, txid: e.trx_id });
      }
      byHash.set(pl.h, entry);
    }
  } catch {
    /* json זר */
  }
}

/**
 * הסריקה החיה עצמה — עימוד אחורה מלא, ניווט-רך בכשל-צומת.
 *
 * get_account_history(account, start, limit) מחזיר את הרשומות
 * [start-limit+1 .. start] (עולה). עימוד אחורה: start = האינדקס
 * המוחלט של הרשומה העתיקה בעמוד הקודם, פחות 1.
 */
async function liveDeepScan(
  chain: "steem" | "hive",
  account: string,
  entriesWanted: number
): Promise<DeepScanResult> {
  const pageSize = chain === "steem" ? SCAN_PAGE_STEEM : SCAN_PAGE_HIVE;
  const byHash = new Map<string, ChainHashEntry>();
  const meta: WebScanMeta = {
    chain,
    pagesScanned: 0,
    entriesScanned: 0,
    entriesTotal: null,
    reachedBeginning: false,
    scannedAt: new Date().toISOString(),
  };

  let start = -1;
  while (meta.entriesScanned < entriesWanted) {
    let hist: Array<[number, HistEntry]> | null = null;
    try {
      hist = chain === "steem"
        ? await steemRpc<Array<[number, HistEntry]>>("condenser_api.get_account_history", [account, start, pageSize])
        : await hiveRpc<Array<[number, HistEntry]>>("condenser_api.get_account_history", [account, start, pageSize]);
    } catch {
      // כשל-צומת: מחזירים את מה שנצבר עד עתה (ניווט-רך, שיטת R50)
      break;
    }
    if (!Array.isArray(hist) || hist.length === 0) {
      meta.reachedBeginning = true;
      break;
    }
    meta.pagesScanned++;
    meta.entriesScanned += hist.length;
    const newestIdx = hist[hist.length - 1][0];
    if (start === -1 && meta.entriesTotal === null) {
      meta.entriesTotal = newestIdx + 1;
    }
    for (const [, e] of hist) ingestHistOp(byHash, e, account);
    const oldestIdx = hist[0][0];
    if (oldestIdx <= 0 || hist.length < pageSize) {
      meta.reachedBeginning = true;
      break;
    }
    start = oldestIdx - 1;
  }

  const res: DeepScanResult = { meta, byHash };
  scanCache.set(chain, { at: Date.now(), entries: meta.entriesScanned, res });
  return res;
}

/**
 * סריקה-עמוקה של כל אופרציות-הרשת על חשבון העוגן — SWR (R53):
 *
 * היסטוריית-שרשרת נספגת בלבד (append-only): חותם שנמצא תקף לנצח,
 * והבייטים עצמם מאומתים ב-sha256 בכל הגשה בלי קשר לגיל הסריקה.
 * לכן סריקה בשלה מוגשת מיד ורענון-רקע single-flight (עם backoff)
 * מביא את הצ׳אנקים החדשים. נמדד לפני: מבקר שהגיע אחרי פקיעת
 * ה-TTL חסם 3.7–4s על סריקה מלאה; עתה — אפס חסימה.
 *
 * חריג-אמת: בקשה לעומק גדול מהמטמון (אימות-עומק) תמיד סורקת
 * בפועל — האימות העמוק אף פעם לא מוגש מעותק רדוד.
 */
export async function deepScanChain(
  chain: "steem" | "hive",
  opts?: { entries?: number; account?: string }
): Promise<DeepScanResult> {
  const account = (opts?.account || WEB_ACCOUNT).toLowerCase();
  const pageSize = chain === "steem" ? SCAN_PAGE_STEEM : SCAN_PAGE_HIVE;
  const entriesWanted = Math.min(Math.max(opts?.entries ?? SCAN_ENTRIES_SERVE, pageSize), SCAN_ENTRIES_MAX);

  const cached = scanCache.get(chain);
  if (cached && cached.entries >= entriesWanted) {
    const now = Date.now();
    if (now - cached.at < SCAN_CACHE_TTL_MS) return cached.res;
    // בשלה — מוגשת מיד; רענון-רקע פעם אחת (backoff 30s משותף)
    if (!scanBgInflight.has(chain) && now >= scanBgNextKickAt) {
      scanBgNextKickAt = now + 30_000;
      const p = liveDeepScan(chain, account, entriesWanted)
        .then(() => undefined)
        .catch(() => undefined)
        .finally(() => scanBgInflight.delete(chain));
      scanBgInflight.set(chain, p);
    }
    return cached.res;
  }

  // קור או דרישת-עומק גדולה — סריקה חיה וחוסמת (אמת-אימות)
  return liveDeepScan(chain, account, entriesWanted);
}

/** מצב-ביניים לסריקה לפי-חשיש — בנוי מעל הסריקה העמוקה */
interface ChainWebOps {
  manifest: (WebManifest & { block?: number; txid?: string }) | null;
  chunks: Array<{ i: number; d: string; block?: number; txid?: string }>;
  scan: WebScanMeta;
}

async function scanWebOps(
  hash: string,
  chain: "steem" | "hive" = "steem",
  entries?: number
): Promise<ChainWebOps> {
  const deep = await deepScanChain(chain, entries ? { entries } : undefined);
  const entry = deep.byHash.get(hash);
  return {
    manifest: entry?.manifest ?? null,
    chunks: entry
      ? [...entry.chunks.values()].sort((a, b) => a.i - b.i).map((c) => ({ i: c.i, d: c.d, block: c.block, txid: c.txid }))
      : [],
    scan: deep.meta,
  };
}

/** חותם החבילה מהשרשרת — Steem ואז Hive (רשת-ביטחון) — null אם לא נחתם */
export async function loadManifestFromChain(
  hash: string
): Promise<(WebManifest & { chain?: "steem" | "hive"; block?: number; txid?: string }) | null> {
  const onSteem = await scanWebOps(hash, "steem");
  if (onSteem.manifest) return { ...onSteem.manifest, chain: "steem" };
  const onHive = await scanWebOps(hash, "hive");
  if (onHive.manifest) return { ...onHive.manifest, chain: "hive" };
  const hinted = await sealFromRepoHint(hash);
  if (hinted) {
    const { chain, block, txid, ...m } = hinted;
    return { ...m, chain, block, txid };
  }
  return null;
}

/**
 * הרצף הקונטיגואלי 1..k של הצ׳אנקים — רק רצף מוכח מורכב.
 * אי-סדר או חסר באמצע לא משחית שקט את הנתונים אלא עוצר בכנות.
 */
export function contiguousPrefix(chunks: Array<{ i: number; chars?: number }>): {
  count: number;
  chars: number;
  nextMissing: number;
} {
  let k = 0;
  let chars = 0;
  const sorted = [...chunks].sort((a, b) => a.i - b.i);
  for (const c of sorted) {
    if (c.i !== k + 1) break;
    k = c.i;
    chars += c.chars ?? 0;
  }
  return { count: k, chars, nextMissing: k + 1 };
}

/**
 * השלמת צ׳אנקים מכתובות-בלוק שרשומת-הריפו מכירה — רק לאלו
 * שהסריקה לא ראתה. הבלוק עצמו (אמת-שרשרת) הוא השופט: אם
 * הרשומה טועה, האופ לא יימצא בבלוק והצ׳אנק לא יתווסף.
 */
async function chunksFromRepoHint(
  hash: string,
  haveIdx: Set<number>
): Promise<Map<number, ChainChunkRaw>> {
  const out = new Map<number, ChainChunkRaw>();
  const rec = await readRepoRecord(hash);
  const recChunks = (rec?.chain?.chunks ?? []).filter(
    (c) => typeof c.block === "number" && c.block > 0 && !haveIdx.has(c.i)
  );
  if (!recChunks.length) return out;
  const uniqueBlocks = [...new Set(recChunks.map((c) => c.block as number))];
  const blockOps = new Map<number, BlockWebOp[]>();
  // קריאות מקביליות חסומות (עד 8) — הצ׳אנקים הם Steem בלבד בפרוטוקול
  const CONC = 8;
  for (let i = 0; i < uniqueBlocks.length; i += CONC) {
    const batch = uniqueBlocks.slice(i, i + CONC);
    const results = await Promise.all(batch.map((b) => readWebOpsFromBlock("steem", b)));
    batch.forEach((b, j) => blockOps.set(b, results[j]));
  }
  for (const c of recChunks) {
    const ops = blockOps.get(c.block as number) ?? [];
    for (const op of ops) {
      if (op.id !== WEB_CHUNK_OP_ID) continue;
      try {
        const pl = JSON.parse(op.json) as { h?: string; i?: number; d?: string };
        if (pl.h === hash && pl.i === c.i && typeof pl.d === "string") {
          out.set(c.i, { i: c.i, d: pl.d, chars: pl.d.length, block: c.block as number, txid: op.txid });
        }
      } catch {
        /* json זר */
      }
    }
  }
  return out;
}

// ── מטמון תוכן (כתובות-תוכן = בלתי-משתנות) ───────────────────────────

export interface PackageBytes {
  bytes: Buffer;
  manifest: WebManifest;
  /** מהיכן הגוף: שרשרת מלאה | ריפו מאומת-חותם | מחסן מקומי ממתין-לחותם */
  source: "chain" | "repo-sealed" | "local-pending";
  /** כמה מהתווים כבר על השרשרת */
  chainChars: number;
  b64len: number;
  cachedAt?: string;
}

const pkgCache = new Map<string, PackageBytes>();
const inflight = new Map<string, Promise<PackageBytes>>();
const CACHE_MAX = 48;
/** רשומת-ריפו (מאומתת בחותם) מתיישנת אחרי 5 דקות — כדי שמקור-ההגשה והתושבות יתעדכנו */
const REPO_CACHE_TTL_MS = 5 * 60_000;

async function repoPackageBytes(hash: string): Promise<Buffer | null> {
  const p = path.join(process.cwd(), "sovereign", "web", "packages", `${hash}.bin`);
  try {
    return await readFile(p);
  } catch {
    return null;
  }
}

/**
 * R55 · רשומת מניפסט ריבונית-מקומית: חבילה שפורסמה ישירות למחסן
 * (בלי-ריפו, בלי-ענן) וממתינה לחותם-שרשרת. מוחזרת רק אם הסטטוס
 * pending-seal בפירוש — רשומות חתומות-שרשרת לא עוברות מסלול זה.
 */
async function readLocalPendingRecord(hash: string): Promise<WebManifestRecord | null> {
  if (!looksLikeSha256(hash)) return null;
  const p = path.join(process.cwd(), "sovereign", "web", "manifests", `${hash}.json`);
  try {
    const raw = JSON.parse(await readFile(p, "utf8")) as WebManifestRecord;
    if (raw?.status === "pending-seal" && raw?.manifest?.sha256 === hash) return raw;
    return null;
  } catch {
    return null;
  }
}

/** בייטי החבילה — שרשרת קודם, ריפו-מאומת אחרי; חותם-שרשרת תמיד חובה. */
export async function fetchPackageBytes(hash: string): Promise<PackageBytes> {
  if (!looksLikeSha256(hash)) throw new Error("חשיש לא תקין — נדרש sha256 בן 64 תווי-הקס");
  const cached = pkgCache.get(hash);
  if (cached) {
    // שרשרת-מלאה = אמת-נצחית (כתובת-תוכן); ריפו-מאומת = מתיישן כדי לראות התקדמות
    const age = cached.cachedAt ? Date.now() - new Date(cached.cachedAt).getTime() : Infinity;
    if (cached.source === "chain" || age < REPO_CACHE_TTL_MS) return cached;
    pkgCache.delete(hash);
  }
  const running = inflight.get(hash);
  if (running) return running;

  const task = (async (): Promise<PackageBytes> => {
    const ops = await scanWebOps(hash, "steem", SCAN_ENTRIES_SERVE);
    let seal = ops.manifest;
    if (!seal) {
      const hiveOps = await scanWebOps(hash, "hive", SCAN_ENTRIES_SERVE);
      seal = hiveOps.manifest;
    }
    if (!seal) {
      // כתובת-בלוק מרשומת-הריפו — אמת מהבלוק עצמו, לא מהרשומה
      const hinted = await sealFromRepoHint(hash);
      if (hinted) {
        const { chain: _c, block, txid, ...m } = hinted;
        seal = { ...m, block, txid };
      }
    }
    if (!seal) {
      // R55 · חבילה ריבונית-מקומית (pending-seal): פורסמה ישירות למחסן
      // בלי-ריפו ובלי-ענן, וממתינה לחותם-שרשרת במסלול-מפתח של המפעיל.
      // ההגשה כנה: רק אם מניפסט pending-seal קיים והבייטים במחסן תואמים
      // לחשיש שבו. הסטטוס מתגלה בכותרות — לא מתחזים לחתום.
      const local = await readLocalPendingRecord(hash);
      if (local) {
        const localBytes = await repoPackageBytes(hash);
        if (localBytes && sha256Hex(localBytes) === hash && localBytes.length === local.manifest.bytes) {
          const entry: PackageBytes = {
            bytes: localBytes,
            manifest: local.manifest,
            source: "local-pending",
            chainChars: 0,
            b64len: local.manifest.b64len,
            cachedAt: new Date().toISOString(),
          };
          if (pkgCache.size >= CACHE_MAX) {
            const oldest = pkgCache.keys().next().value;
            if (oldest) pkgCache.delete(oldest);
          }
          pkgCache.set(hash, entry);
          return entry;
        }
        throw new Error("עותק המחסן המקומי לא תואם למניפסט pending-seal — סירוב הגשה (החשיש השופט)");
      }
      throw new Error("אין חותם על השרשרת (Steem/Hive) עבור חשיש זה — החבילה לא נחתמה על ידי הרשת");
    }
    const m = seal;

    // צ׳אנקים: סריקה-טרייה + השלמה ממוקדת-בלוק לכל היתר
    const chunkMap = new Map<number, ChainChunkRaw>(ops.chunks.map((c) => [c.i, { ...c, chars: c.d.length }]));
    if (chunkMap.size < m.b64len / RC_MODEL.chunkCharsMin) {
      const hinted = await chunksFromRepoHint(hash, new Set(chunkMap.keys()));
      for (const [i, c] of hinted) if (!chunkMap.has(i)) chunkMap.set(i, c);
    }

    // 1) נסיון שרשרת-מלאה: הרכבה לפי רצף קונטיגואלי בלבד
    const ordered = [...chunkMap.values()].sort((a, b) => a.i - b.i);
    const joined = ordered.map((c) => c.d).join("");
    if (joined.length === m.b64len) {
      const bytes = Buffer.from(joined, "base64");
      if (sha256Hex(bytes) === hash && bytes.length === m.bytes) {
        const entry: PackageBytes = {
          bytes,
          manifest: m,
          source: "chain",
          chainChars: joined.length,
          b64len: m.b64len,
          cachedAt: new Date().toISOString(),
        };
        pkgCache.set(hash, entry);
        return entry;
      }
      throw new Error("אימות שרשרת נכשל — הבייטים שהורכבו אינם תואמים לחותם (דלג על ריפו: השרשרת השופטת)");
    }

    // 2) ריפו מאומת-חותם: המחסן מותר רק אם sha256 תואם לחותם שעל השרשרת
    const repoBytes = await repoPackageBytes(hash);
    if (!repoBytes) {
      throw new Error(
        `הצ׳אנקים על השרשרת חלקיים (${joined.length}/${m.b64len} תווים) ואין עותק-ריפו — ההגשה ממתינה להשלמת העלייה`
      );
    }
    if (sha256Hex(repoBytes) !== hash || repoBytes.length !== m.bytes) {
      throw new Error("עותק הריפו לא תואם לחותם שעל השרשרת — סירוב הגשה (השרשרת השופטת)");
    }
    const entry: PackageBytes = {
      bytes: repoBytes,
      manifest: m,
      source: "repo-sealed",
      chainChars: joined.length,
      b64len: m.b64len,
      cachedAt: new Date().toISOString(),
    };
    if (pkgCache.size >= CACHE_MAX) {
      const oldest = pkgCache.keys().next().value;
      if (oldest) pkgCache.delete(oldest);
    }
    pkgCache.set(hash, entry);
    return entry;
  })();

  inflight.set(hash, task);
  try {
    return await task;
  } finally {
    inflight.delete(hash);
  }
}

/** הצצה למטמון בלבד */
export function peekCache(hash: string): PackageBytes | undefined {
  return pkgCache.get(hash);
}

/** ניקוי מטמון של חבילה (אחרי התקדמות עלייה) */
export function evictCache(hash: string): void {
  pkgCache.delete(hash);
  scanCache.clear();
}

// ── קורא ZIP מינימלי (STORE + DEFLATE) — בלי תלות חוץ ────────────────

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export function parseZip(buf: Buffer): ZipEntry[] {
  let eocd = -1;
  const minStart = Math.max(0, buf.length - 66_000);
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP לא תקין: לא נמצאה חתימת סוף-הארכיון");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) {
      throw new Error(`ZIP לא תקין: רשומת מדריך ${n} פגומה`);
    }
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString("utf8");
    off += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    if (lho + 30 > buf.length || buf.readUInt32LE(lho) !== 0x04034b50) {
      throw new Error(`ZIP לא תקין: כותרת מקומית של ${name} פגומה`);
    }
    const lNameLen = buf.readUInt16LE(lho + 26);
    const lExtraLen = buf.readUInt16LE(lho + 28);
    const dataStart = lho + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`ZIP: שיטת דחיסה לא נתמכת (${method}) בקובץ ${name}`);
    entries.push({ name, data });
  }
  return entries;
}

export function zipIndex(entries: ZipEntry[]): Map<string, ZipEntry> {
  const map = new Map<string, ZipEntry>();
  for (const e of entries) {
    const safe = e.name.replace(/^\.\//, "");
    map.set(safe, e);
    const base = safe.includes("/") ? safe.slice(safe.lastIndexOf("/") + 1) : safe;
    if (!map.has(base)) map.set(base, e);
  }
  return map;
}

// ── כותב ZIP מינימלי — אריזה-מחדש בדחיסה מקסימלית (R51) ───────────────
//
// כל תו ב-b64 עולה ~320k RC על השרשרת. אריזה מחדש של החבילה
// ב-deflate רמה-9 חוסכת RC אמיתי לכל אורך ההגירה. התוכן זהה
// בדיוק — רק המיכל דחוס יותר, והחיסכון מדווח בכנות.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function buildZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const comp = deflateRawSync(e.data, { level: 9 });
    const useDeflate = comp.length < e.data.length;
    const data = useDeflate ? comp : e.data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(e.data);
    const utf8Flag = /[^\x00-\x7F]/.test(e.name) ? 0x0800 : 0;
    // תאריך DOS (2026-01-01 קבוע — כתובת-תוכן דטרמיניסטית)
    const dosTime = 0;
    const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4); // גרסה נדרשת
    lfh.writeUInt16LE(utf8Flag, 6);
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt16LE(dosTime, 10);
    lfh.writeUInt16LE(dosDate, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(data.length, 18);
    lfh.writeUInt32LE(e.data.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    parts.push(lfh, nameBuf, data);
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4); // גרסה יוצרת
    cdh.writeUInt16LE(20, 6); // גרסה נדרשת
    cdh.writeUInt16LE(utf8Flag, 8);
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt16LE(dosTime, 12);
    cdh.writeUInt16LE(dosDate, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(data.length, 20);
    cdh.writeUInt32LE(e.data.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0, 38);
    cdh.writeUInt32LE(offset, 42);
    central.push(cdh, nameBuf);
    offset += lfh.length + nameBuf.length + data.length;
  }
  const centralSize = central.reduce((s, b) => s + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, ...central, eocd]);
}

export interface RepackResult {
  bytes: Buffer;
  originalBytes: number;
  files: number;
  savedPct: number;
  repacked: boolean;
}

/** אריזה-מחדש בדחיסה מקסימלית — רק אם באמת חוסך; אחרת המקור נשמר */
export function repackZipMaxDeflate(buf: Buffer): RepackResult {
  const entries = parseZip(buf);
  if (!entries.length) throw new Error("ה-zip ריק מקבצים");
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  const rebuilt = buildZip(sorted);
  if (rebuilt.length >= buf.length) {
    return { bytes: buf, originalBytes: buf.length, files: entries.length, savedPct: 0, repacked: false };
  }
  // אימות-עגול: הפריקה חייבת להחזיר בדיוק את אותם קבצים
  const round = parseZip(rebuilt);
  if (round.length !== entries.length) {
    return { bytes: buf, originalBytes: buf.length, files: entries.length, savedPct: 0, repacked: false };
  }
  for (let i = 0; i < entries.length; i++) {
    if (round[i].name !== entries[i].name || !round[i].data.equals(entries[i].data)) {
      return { bytes: buf, originalBytes: buf.length, files: entries.length, savedPct: 0, repacked: false };
    }
  }
  return {
    bytes: rebuilt,
    originalBytes: buf.length,
    files: entries.length,
    savedPct: Math.round((1 - rebuilt.length / buf.length) * 1000) / 10,
    repacked: true,
  };
}

// ── MIME ──────────────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  csv: "text/plain; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",
  pdf: "application/pdf",
  zip: "application/zip",
};

export function mimeOf(name: string): string {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  return MIME[ext] || "application/octet-stream";
}

/** סיווגי-העלאה המותרים — זיפ שלם או קובץ-רשת בודד */
export const UPLOAD_SINGLE_EXTS = new Set([
  "html", "htm", "svg", "png", "jpg", "jpeg", "gif", "webp", "avif", "ico",
  "json", "txt", "md", "csv", "css", "js", "mjs", "pdf",
]);

// ── הגשה ─────────────────────────────────────────────────────────────

export interface ServedFile {
  bytes: Buffer;
  mime: string;
  manifest: WebManifest;
  resolvedPath: string;
  source: "chain" | "repo-sealed" | "local-pending";
}

export async function servePackageFile(hash: string, innerPath?: string): Promise<ServedFile> {
  const pkg = await fetchPackageBytes(hash);
  const { bytes, manifest } = pkg;
  if (manifest.mime !== "application/zip") {
    return { bytes, mime: manifest.mime, manifest, resolvedPath: manifest.name, source: pkg.source };
  }
  const idx = zipIndex(parseZip(bytes));
  let wanted = (innerPath || manifest.entry || "index.html").replace(/^\/+/, "");
  if (wanted === "" || wanted.endsWith("/")) wanted += "index.html";
  if (wanted.includes("..")) throw new Error("נתיב לא חוקי");
  let hit = idx.get(wanted);
  if (!hit) hit = idx.get(wanted.split("/").pop() || "");
  if (!hit) {
    throw new Error(`הקובץ "${wanted}" לא נמצא בחבילה. קבצים: ${[...idx.keys()].slice(0, 12).join(", ")}`);
  }
  return { bytes: hit.data, mime: mimeOf(hit.name), manifest, resolvedPath: hit.name, source: pkg.source };
}

// ── רישום קבצי חבילה — דפדוף התוכן ────────────────────────────────────

export interface ZipFileStat {
  name: string;
  bytes: number;
}

export interface PackageListing {
  files: ZipFileStat[];
  entry?: string;
  totalBytes: number;
}

/** רישום הקבצים בחבילה — לזיפים בלבד; לקובץ-בודד מוחזר הקובץ עצמו */
export async function listPackageFiles(hash: string): Promise<PackageListing> {
  const pkg = await fetchPackageBytes(hash);
  const { bytes, manifest } = pkg;
  if (manifest.mime !== "application/zip") {
    return { files: [{ name: manifest.name, bytes: bytes.length }], entry: manifest.name, totalBytes: bytes.length };
  }
  const entries = parseZip(bytes);
  const files: ZipFileStat[] = entries
    .map((e) => ({ name: e.name.replace(/^\.\//, ""), bytes: e.data.length }))
    .sort((a, b) => {
      const ea = a.name === manifest.entry ? 0 : 1;
      const eb = b.name === manifest.entry ? 0 : 1;
      if (ea !== eb) return ea - eb;
      return a.name.localeCompare(b.name);
    });
  return { files, entry: manifest.entry, totalBytes: manifest.bytes };
}

// ── מודל הגירה כן — המתמטיקה של ה-RC ──────────────────────────────────

export interface MigrationEstimate {
  remainingChars: number;
  chunksLeft: number;
  rcNeeded: number;
  /** ימי-רגנרציה בהנחת מאגר יבש לחלוטין; null כשאין מדידת רגנרציה */
  days: number | null;
}

/**
 * אומדן הגירה-כן: כמה RC נדרש וכמה ימים של רגנרציה מלאה.
 * המודל הנלמד מהשרשרת (בסיס + לתו · מרווח 1.15) — לא הבטחה, תחזית.
 */
export function estimateMigration(remainingChars: number, regenPerDay: number | null): MigrationEstimate {
  const chunksLeft = Math.max(1, Math.ceil(remainingChars / RC_MODEL.chunkCharsMax));
  const rcNeeded = Math.round((RC_MODEL.base * chunksLeft + RC_MODEL.perChar * remainingChars) * RC_MODEL.margin);
  return {
    remainingChars,
    chunksLeft,
    rcNeeded,
    days: regenPerDay && regenPerDay > 0 ? Math.round((rcNeeded / regenPerDay) * 10) / 10 : null,
  };
}

// ── אימות חי מלא (בלי מטמון) — מנוע ההוכחות ─────────────────────────

export interface VerifyChunkReport {
  i: number;
  chars: number;
  onChain: boolean;
  block?: number | null;
  txid?: string | null;
}

export interface VerifyReport {
  hash: string;
  ok: boolean;
  name: string;
  bytes: number;
  sealOnChain: boolean;
  sealChain: "steem" | "hive" | null;
  sealBlock: number | null;
  sealTxid: string | null;
  chainChars: number;
  b64len: number;
  residencyPct: number;
  assembledSha: string | null;
  repoCopy: { exists: boolean; shaMatches: boolean } | null;
  manifest: WebManifest | null;
  at: string;
  /** R51: מטא-סריקה — כמה עומק נקרא באמת עד למציאת האמת */
  scan: {
    steem: WebScanMeta | null;
    hive: WebScanMeta | null;
  };
  /** האינדקס הבא החסר ברצף הקונטיגואלי (ההגירה תמשיך מכאן) */
  nextMissingChunk: number | null;
  contiguousChunks: number;
  /** כמה צ׳אנקים אומתו מקריאות-בלוק ממוקדות (מעבר לחלון הסריקה) */
  blockVerifiedChunks: number;
}

/** אימות מקיר לקיר מול השרשרת הציבורית — סריקה עמוקה + השלמה ממוקדת-בלוק. */
export async function verifyPackageOnChain(hash: string, entries?: number): Promise<VerifyReport> {
  const report: VerifyReport = {
    hash,
    ok: false,
    name: "",
    bytes: 0,
    sealOnChain: false,
    sealChain: null,
    sealBlock: null,
    sealTxid: null,
    chainChars: 0,
    b64len: 0,
    residencyPct: 0,
    assembledSha: null,
    repoCopy: null,
    manifest: null,
    at: new Date().toISOString(),
    scan: { steem: null, hive: null },
    nextMissingChunk: null,
    contiguousChunks: 0,
    blockVerifiedChunks: 0,
  };
  const budget = Math.min(Math.max(entries ?? SCAN_ENTRIES_VERIFY, 100), SCAN_ENTRIES_MAX);
  const ops = await scanWebOps(hash, "steem", budget);
  report.scan.steem = ops.scan;
  let seal = ops.manifest;
  if (!seal) {
    const hiveOps = await scanWebOps(hash, "hive", budget);
    report.scan.hive = hiveOps.scan;
    seal = hiveOps.manifest;
    if (seal) report.sealChain = "hive";
  } else {
    report.sealChain = "steem";
  }
  if (!seal) {
    const hinted = await sealFromRepoHint(hash);
    if (hinted) {
      seal = hinted;
      report.sealChain = hinted.chain;
    }
  }
  if (!seal) return report;
  report.sealOnChain = true;
  report.sealBlock = seal.block ?? null;
  report.sealTxid = seal.txid ?? null;
  report.manifest = seal;
  report.name = seal.name;
  report.bytes = seal.bytes;
  report.b64len = seal.b64len;

  // צ׳אנקים: סריקה-עמוקה + השלמה ממוקדת-בלוק לכל היתר
  const chunkMap = new Map<number, ChainChunkRaw>(ops.chunks.map((c) => [c.i, { ...c, chars: c.d.length }]));
  if (chunkMap.size < Math.ceil(seal.b64len / RC_MODEL.chunkCharsMin)) {
    const hinted = await chunksFromRepoHint(hash, new Set(chunkMap.keys()));
    report.blockVerifiedChunks = hinted.size;
    for (const [i, c] of hinted) if (!chunkMap.has(i)) chunkMap.set(i, c);
  }

  const prefix = contiguousPrefix([...chunkMap.values()].map((c) => ({ i: c.i, chars: c.chars })));
  report.contiguousChunks = prefix.count;
  report.nextMissingChunk = prefix.nextMissing;
  const ordered = [...chunkMap.values()].sort((a, b) => a.i - b.i);
  const joined = ordered.map((c) => c.d).join("");
  report.chainChars = joined.length;
  report.residencyPct = report.b64len ? Math.round((joined.length / report.b64len) * 1000) / 10 : 0;

  if (joined) {
    const bytes = Buffer.from(joined, "base64");
    report.assembledSha = sha256Hex(bytes);
    report.bytes = bytes.length;
  }
  const repoBytes = await repoPackageBytes(hash);
  if (repoBytes) {
    report.repoCopy = { exists: true, shaMatches: sha256Hex(repoBytes) === hash };
  } else {
    report.repoCopy = { exists: false, shaMatches: false };
  }
  report.ok =
    report.sealOnChain &&
    joined.length === report.b64len &&
    report.assembledSha === hash;
  return report;
}

// ── מצב ה-RC החי של חשבון האחסון ─────────────────────────────────────

export interface RcProbe {
  account: string;
  mana: number;
  max: number;
  pct: number;
  regenPerDay: number;
  headBlock: number | null;
  chainTime: string | null;
  /** אמת-מטמון: כמה שניות מאז מדידת-הרשת האחרונה (0 = נמדד עכשיו) */
  measuredAgoSec?: number;
  /** true = הרשת נפלה וזו דגימה ישנה שממשיכה לשרת בכנות */
  stale?: boolean;
}

// ── מטמון-מד RC חכם: מדידת-רשת נדיבה, חישוב-התחדשות מקומי בין לבין ─────
//
// התחדשות ה-RC ליניארית לחלוטין (max/432,000 לשנייה — אותה נוסחה
// שהשרשרת עצמה מחשבת), ולכך דגימה אחת של (current_mana, last_update_time)
// מספיקה כדי לחשב את המד לכל רגע אחר-כך — עד שמישהו מוציא RC בפועל
// (שידור צ׳אנק; הסוכן בענן מודד בעצמו לפני שידור, אז התצוגה לעולם
// לא מקבלת החלטות שידור מהמטמון הזה).
//
// לקח-R53 (נמדד חי ביומן ה-dev): הגרסה הקודמת חסמה את הקריאה על
// מדידת-רשת חיה כשהדגימה התיישנה — polling של 60 שניות מול TTL של
// 90 יצר תבנית "900ms, 40ms, 900ms…" נמדדת. מעתה SWR: דגימה בשלה
// מוגשת מיד (חישוב-regen מדויק, measuredAgoSec גלוי) ורענון-רקע
// single-flight רץ פעם בכל 15 שניות לכל היותר — צומת שנפל לא
// מוצף בבעיטות. stale=true נשמר למשמעותו הקשה: הרשת נפלה וזו
// דגימה ישנה שממשיכה לשרת בכנות.

interface RcSample {
  max: number;
  manaAtLut: number; // current_mana הגולמי ברגע last_update_time
  lutSec: number;
  headBlock: number | null;
  chainTime: string | null;
}

const RC_SAMPLE_TTL_MS = 90_000;
const RC_KICK_BACKOFF_MS = 15_000; // רענון-רקע: בעיטה אחת לכל היותר כל 15 שניות

let rcSample: { at: number; s: RcSample } | null = null;
let rcInflight: Promise<RcSample | null> | null = null;
let rcNextKickAt = 0;

function rcProbeFromSample(s: RcSample, atMs: number, measuredAtMs: number, stale: boolean): RcProbe {
  const nowSec = Math.floor(atMs / 1000);
  const mana = Math.min(s.max, s.manaAtLut + Math.max(0, nowSec - s.lutSec) * (s.max / 432_000));
  return {
    account: WEB_ACCOUNT,
    mana: Math.round(mana),
    max: s.max,
    pct: Math.round((mana / Math.max(1, s.max)) * 1000) / 10,
    regenPerDay: Math.round((s.max / 432_000) * 86_400),
    headBlock: s.headBlock,
    chainTime: s.chainTime,
    measuredAgoSec: Math.max(0, Math.round((atMs - measuredAtMs) / 1000)),
    stale,
  };
}

/** מדידת-רשת חיה אחת (שתי הקריאות במקביל — נמדד: ~0.7s במקום ~1.5s) */
async function liveRcSample(account: string): Promise<RcSample> {
  const [rcRes, dgp] = await Promise.all([
    steemRpc<{
      rc_accounts: Array<{
        max_rc: string | number;
        rc_manabar: { current_mana: string | number; last_update_time: number };
      }>;
    }>("rc_api.find_rc_accounts", { accounts: [account] }),
    steemRpc<DynamicGlobalProperties>("condenser_api.get_dynamic_global_properties", []).catch(
      () => null,
    ),
  ]);
  const a = rcRes?.rc_accounts?.[0];
  if (!a) throw new Error("no-rc-account");
  const s: RcSample = {
    max: Number(a.max_rc),
    manaAtLut: Number(a.rc_manabar.current_mana),
    lutSec: Number(a.rc_manabar.last_update_time),
    headBlock: dgp?.head_block_number ?? null,
    chainTime: dgp?.time ?? null,
  };
  rcSample = { at: Date.now(), s };
  return s;
}

/** מדידה חיה single-flight — קריאות מקבילות מתאחדות ל-promise אחד */
function startRcProbe(account: string): Promise<RcSample | null> {
  if (rcInflight) return rcInflight;
  const p = liveRcSample(account)
    .catch(() => null) // כישלון: הדגימה הישנה ממשיכה לשרת (stale בפעם הבאה שתיבדק)
    .finally(() => {
      rcInflight = null;
    });
  rcInflight = p;
  return p;
}

export interface ProbeRcOpts {
  /**
   * true = מדידת-רשת חיה תמיד, בלי פשרות — לאימות-אמת (/api/health).
   * ברירת-מחדל false = מסלול-תצוגה: מיידי מהדגימה + רענון-רקע.
   */
  fresh?: boolean;
}

export async function probeStorageRc(
  account: string = WEB_ACCOUNT,
  opts: ProbeRcOpts = {},
): Promise<RcProbe | null> {
  const now = Date.now();

  // מסלול-האמת: מדידה חיה תמיד (הצטרפות למדידה שכבר רצה זה בסדר — היא חיה)
  if (opts.fresh) {
    const ok = await startRcProbe(account);
    if (!ok || !rcSample) return null;
    return rcProbeFromSample(rcSample.s, now, rcSample.at, false);
  }

  // יש דגימה: מוגשת מיד — טריה או בשלה (חישוב-regen מקומי מדויק), ואם בשלה —
  // רענון-רקע single-flight עם backoff כדי שצומת שנפל לא יוצף.
  // (עותק מקומי — צמצום על המודול מכבה את היצוק של rcSample אחרי
  // המתנה ל-startRcProbe שממלא אותו מחדש)
  const cached = rcSample;
  if (cached) {
    if (now - cached.at >= RC_SAMPLE_TTL_MS && now >= rcNextKickAt) {
      rcNextKickAt = now + RC_KICK_BACKOFF_MS;
      void startRcProbe(account);
    }
    return rcProbeFromSample(cached.s, now, cached.at, false);
  }

  // קור: אין דגימה — מדידה ראשונה, ממתינים (single-flight מאחד קריאות מקבילות)
  const ok = await startRcProbe(account);
  if (!ok || !rcSample) return null;
  return rcProbeFromSample(rcSample.s, Date.now(), rcSample.at, false);
}

/** נתיבי הספריות של רשת-האחסון בריפו */
export function webRepoPaths(repoRoot: string) {
  return {
    manifests: path.join(repoRoot, "sovereign", "web", "manifests"),
    inbox: path.join(repoRoot, "sovereign", "web", "inbox"),
    packages: path.join(repoRoot, "sovereign", "web", "packages"),
  };
}

// ── פרופיל מה העוגנים נותנים — אמת מדודה בלבד ───────────────────────

export interface AnchorCapability {
  key: string;
  title: string;
  detail: string;
  measured: string;
}

export function anchorCapabilities(): AnchorCapability[] {
  return [
    {
      key: "storage",
      title: "אחסון על שרשרת ציבורית — במחיר האמיתי",
      detail:
        "כל ביט שנכתב ל-Steem נשמר לנצח בכל צומת מלא בעולם. המחיר נמדד אצלנו בפועל: ~65M RC בסיס + ~320k RC לכל תו — החבילות עולות בצ׳אנקים אדפטיביים בקצב שהמאגר מרשה, והחותם (sha256) נוחת ראשון. העלאה מאורזת-מחדש בדחיסה מקסימלית כדי שכל תו יספור פחות.",
      measured: "probe2: 1,000 תווים = 404M RC · 2,000 = 725M · 4,000 = 1,365M",
    },
    {
      key: "identity",
      title: "חתימת רשת ללא שרת",
      detail:
        "חשבון העוגן (cashmachine, ~4,678 SP) חותם על כל פעולה במפתח ה-posting. המפתח הציבורי אומת ב-2026-09-19 מול השרשרת (STM6EML1…) — ההרשאה היא השרשרת עצמה.",
      measured: "פעיל מ-2018 · 107 פרסומים · מעגן את הספר עד היום",
    },
    {
      key: "budget",
      title: "תקציב כתיבה כלכלי אמיתי (RC)",
      detail:
        "מאגר 2.35 מיליארד RC, התחדשות ~470 מיליון ביום. הרשת מפרסמת רק מעל רצפת בטיחות, מודדת את העלות בפועל אחרי כל שידור, ולומדת מדחיות (ההודעה needs-X-RC היא מדידה חינם). יותר SP = קצב הגירה גבוה יותר.",
      measured: "המאגר נמדד חי בכל פעימה — המד למעלה",
    },
    {
      key: "index",
      title: "חותם, אינדקס וקריאות-בלוק — נטולי-שרת",
      detail:
        "החותם של כל חבילה (custom_json id=saos.web.v1) נושא את ה-sha256 בהיסטוריית החשבון הציבורית. השרת סורק בעימוד chain-aware (Steem 100/עמוד, נמדד חי) ומשלים מקריאות-בלוק ממוקדות מכתובות שרשומת-הריפו מכירה — החותם והצ׳אנקים נמצאים בכל עומק היסטוריה, והבלוק עצמו הוא האמת.",
      measured: "36,894 רשומות Steem נמדדו חי · block_api נמדד חי בשתי השרשראות",
    },
  ];
}
