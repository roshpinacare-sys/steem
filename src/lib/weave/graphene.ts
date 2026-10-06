// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Graphene — שכבת שידור לשרשראות Graphene (Steem + Hive)
//
// העברה נאמנה של הדפוס המוכח של הצי (agent/anchor.cjs, Tasks 44/79/82):
//   · Steem — steem-js native (steem.broadcast.sendAsync) — חינם-RC
//   · Hive  — חתימה מקומית עם chain_id המוחלף (steem.auth.signTransaction)
//              ושידור גולמי ב-broadcast_transaction — מאחורי שער RC
//   · אישור txids מההיסטוריה — "ההיסטוריה השופטת היחידה" (לקח 2026-09-05:
//              צומת יכול להחזיר שגיאת-RC בזמן שה-tx באמת נכנס)
//
// רשות: POSTING בלבד (required_posting_auths) — "אפס סיכון הון" לפי
// מסמך המפתחות של הצי (STEEM_KEYS_PLAYBOOK §2.1: כל ה-L2 — custom_json
// בסמכות posting). המפתח לעולם לא מודפס ולא נכנס לגיט.
// ─────────────────────────────────────────────────────────────────────

import steem from "steem";
import type { GrapheneOperation, SignedGrapheneTransaction } from "steem";
// r184-b — מודול-הפעולות הפנימי (סדר-ה-op-ids). import-רגיל-במכוון (לא
// createRequire) — כך-bun מפתר-לאותו-עותק-ממומש-של-node_modules כמו ה-import
// למעלה (createRequire פותר-ל-cache-של-bun — עותק-שבור-מקישורים, נמדד-חי
// ב-runner-הענן: "Unexpected while resolving package 'bs58'").
// @ts-expect-error — למודול הפנימי אין טיפוסים
import { operation as steemOperation } from "steem/lib/auth/serializer/src/operations";

// R120: steem.61bts.com מת (דומיין-חניה סיני, תשובת-HTML עם BOM — נמדד חי)
// — הוסר. שני הצמתים הנותרים אומתו חי בזמן ההסרה.
export const STEEM_RPC_NODES = [
  "https://api.steemit.com",
  "https://api.justyy.com",
] as const;

export const HIVE_RPC = process.env.HIVE_RPC || "https://api.hive.blog";
export const HIVE_CHAIN_ID =
  "beeab0de00000000000000000000000000000000000000000000000000000000";

/** סף RC לרגל ה-Hive — נמדד 2026-09-15 14:08Z: עיגון custom_json עולה
 *  ~273M RC כשמאגר הרשת עמוס; הרצפה במרווח מעל המדידה (הדפוס: שער-תקציב).
 *  סביבה יכולה להדוף: HIVE_RC_FLOOR=… (אינטים בליד׳) */
export const HIVE_RC_FLOOR = Number(process.env.HIVE_RC_FLOOR || 300e6);
/** סף RC לרגל ה-Steem — נמדד: עיגון עולה ~169M RC בעת עומס */
export const STEEM_RC_FLOOR = Number(process.env.STEEM_RC_FLOOR || 200e6);
/** רגנרציית ה-RC — 5 ימים (432,000 שניות) בשתי השרשראות */
const RC_REGEN_SEC = 432000;

export class GrapheneError extends Error {}

/** JSON-RPC condenser/appbase על HTTPS — ללא תלות ב-WebSocket */
export async function rpcV4<T = unknown>(
  url: string,
  method: string,
  params: unknown,
  timeoutMs = 25_000
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
      signal: ctrl.signal,
    });
    const json = (await res.json()) as { result?: T; error?: { message?: string } };
    if (json.error) throw new GrapheneError(json.error.message || "rpc error");
    return json.result as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface DynamicGlobalProperties {
  head_block_number: number;
  head_block_id: string;
  time: string;
}

export async function getDgp(endpoint: string): Promise<DynamicGlobalProperties> {
  return rpcV4<DynamicGlobalProperties>(
    endpoint,
    "condenser_api.get_dynamic_global_properties",
    []
  );
}

/** בניית custom_json בסמכות posting — אופ ה-L2 של האקוסיסטם */
export function buildPostingCustomJson(
  account: string,
  id: string,
  payload: Record<string, unknown>
): GrapheneOperation {
  return [
    "custom_json",
    {
      required_auths: [],
      required_posting_auths: [account],
      id,
      json: JSON.stringify(payload),
    },
  ];
}

/** שער ה-RC של Hive (דפוס 103 של הצי): מנה מחושבת עם רגנרציה — דילוג-כנה, לא כשל */
export async function hiveRcGate(
  account: string,
  floor: number = HIVE_RC_FLOOR
): Promise<{ ok: boolean; mana: number; max: number; reason?: string }> {
  type RcAccount = {
    account: string;
    max_rc: string | number;
    rc_manabar: { current_mana: string | number; last_update_time: number };
  };
  const accounts = await rpcV4<RcAccount[]>(
    HIVE_RPC,
    "condenser_api.find_rc_accounts",
    [[account]]
  );
  const a = accounts?.[0];
  if (!a) return { ok: false, mana: 0, max: 0, reason: "rc-account-not-found" };
  const max = Number(a.max_rc);
  const dgp = await getDgp(HIVE_RPC);
  const now = Math.floor(new Date(dgp.time + "Z").getTime() / 1000);
  const lut = Number(a.rc_manabar.last_update_time);
  const mana = Math.min(
    max,
    Number(a.rc_manabar.current_mana) + Math.max(0, now - lut) * (max / RC_REGEN_SEC)
  );
  if (mana < floor) {
    return {
      ok: false,
      mana: Math.round(mana),
      max,
      reason: `rc-gated (mana=${Math.round(mana).toExponential(2)} < floor=${floor.toExponential(2)} — regen budget, honest skip)`,
    };
  }
  return { ok: true, mana: Math.round(mana), max };
}

/** שער ה-RC של Steem (Task 25): אותה מנה מחושבת, API אחר — rc_api
 *  עם מבנה {accounts}. נולד מהמדידה הקשה: שידור שמוחזר ב-RC עלה בכישלון
 *  אדום של כל הקו — בעוד דילוג-כנה שומר על הקדנס ומדווח באמת. */
export async function steemRcGate(
  account: string,
  floor: number = STEEM_RC_FLOOR
): Promise<{ ok: boolean; mana: number; max: number; reason?: string }> {
  type RcAccount = {
    max_rc: string | number;
    rc_manabar: { current_mana: string | number; last_update_time: number };
  };
  let a: RcAccount | null = null;
  let dgp: DynamicGlobalProperties | null = null;
  let lastErr = "";
  for (const node of STEEM_RPC_NODES) {
    try {
      const res = await rpcV4<{ rc_accounts: RcAccount[] }>(
        node,
        "rc_api.find_rc_accounts",
        { accounts: [account] }
      );
      a = res?.rc_accounts?.[0] ?? null;
      if (a) {
        dgp = await getDgp(node); // זמן-השרשרת — לא שעון מקומי
        break;
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message.slice(0, 60) : String(e);
    }
  }
  if (!a || !dgp) {
    return { ok: false, mana: 0, max: 0, reason: `rc-api-unreachable (${lastErr}) — honest skip` };
  }
  const max = Number(a.max_rc);
  /* תיקון אמת (Task 29, נמדד בשרשרת): ה-manabar השמור מתעדכן רק
   * בטרנזאקציה של החשבון — קריאת הערך הקפוא בלי חישוב-רגנרציה יוצרת
   * קיפאון-עדן: השער חוסם ⇒ אין טרנזאקציה ⇒ הערך לעולם לא מתעדכן ⇒
   * השער חוסם לנצח (נמדד: קו Steem תקוע מ-13:09Z עם מנה קפואה 22.3M).
   * התיקון — אותה נוסחה בדיוק שכבר רצה בשער ה-Hive: מנה חיבה =
   * שמורה + זמן-שרשרת שחלף × קצב. הרצפה נשארת — השמרנות חיה בסף. */
  const now = Math.floor(new Date(dgp.time + "Z").getTime() / 1000);
  const lut = Number(a.rc_manabar.last_update_time);
  const mana = Math.min(
    max,
    Number(a.rc_manabar.current_mana) + Math.max(0, now - lut) * (max / RC_REGEN_SEC)
  );
  if (mana < floor) {
    return {
      ok: false,
      mana: Math.round(mana),
      max,
      reason: `rc-gated (live-mana=${Math.round(mana).toExponential(2)} < floor=${floor.toExponential(2)} — regen budget, honest skip)`,
    };
  }
  return { ok: true, mana: Math.round(mana), max };
}

/** בניית עסקה + חתימה מקומית עם chain_id של הרשת המבוקשת */
export function signGrapheneTx(
  endpoint: string,
  chainId: string,
  ops: GrapheneOperation[],
  wif: string
): Promise<SignedGrapheneTransaction> {
  return (async () => {
    const dgp = await getDgp(endpoint);
    const tx = {
      ref_block_num: dgp.head_block_number & 0xffff,
      ref_block_prefix: Buffer.from(dgp.head_block_id, "hex").readUInt32LE(4),
      expiration: new Date(new Date(dgp.time + "Z").getTime() + 60_000)
        .toISOString()
        .slice(0, 19),
      operations: ops,
      extensions: [] as unknown[],
    };
    const prev = steem.config.get("chain_id");
    steem.config.set("chain_id", chainId);
    try {
      return steem.auth.signTransaction(tx, [wif]);
    } finally {
      steem.config.set("chain_id", prev);
    }
  })();
}

/**
 * r184 — חתימה תחת-סדר-פעולות-חלופי (מזלגות-גרפינה: Blurt כרתה 6 פעולות —
 * כל-ה-ids אחריהן זזים; custom_json 18→12, נמדד בבייט 11 ומוכח-חי-על-השרשרת:
 * txid 35f28817… בלוק 64177707 · txid ab676bc3… בלוק 64177963).
 *
 * המנגנון: סדר-ה-op-ids חי-ב-operation.st_operations (מערך-בר-החלפה).
 * לזמן-החתימה בלבד המערך מוחלף בסדר-המבוקש (בשמות, מתוך-הסריאליזרים
 * של-אותה-ספרייה) ומוחזר-ב-finally — שאר-המערכת (Steem/Hive) לא-נוגעת.
 * החתימה עצמה: אותו-מופע-משותף-של-steem-js — אותו-קוד-מוכח של שני-הקווים.
 */
export function signWithOpOrder(
  tx: Record<string, unknown>,
  chainId: string,
  wif: string,
  opOrder: readonly string[]
): Record<string, unknown> {
  const original = (steemOperation as { st_operations: Array<{ operation_name: string }> }).st_operations;
  const byName = new Map(original.map((s) => [s.operation_name, s]));
  const patched = opOrder.map((n) => byName.get(n)).filter(Boolean) as typeof original;
  if (patched.length !== opOrder.length) {
    throw new Error("op-order-פער: פעולה-מסדרת חסרה בספרייה — סירוב-כנה");
  }
  const prev = steem.config.get("chain_id");
  steem.config.set("chain_id", chainId);
  (steemOperation as { st_operations: Array<{ operation_name: string }> }).st_operations = patched;
  try {
    return steem.auth.signTransaction(tx, [wif]) as Record<string, unknown>;
  } finally {
    steem.config.set("chain_id", prev);
    (steemOperation as { st_operations: Array<{ operation_name: string }> }).st_operations = original;
  }
}

/** שידור Steem — steem-js native (העבר מדויק של הצי) */
export async function steemBroadcast(
  ops: GrapheneOperation[],
  wif: string
): Promise<{ txid: string | null; note?: string }> {
  try {
    const conf = await steem.broadcast.sendAsync(
      { operations: ops, extensions: [] },
      [wif]
    );
    return { txid: conf?.id || null };
  } catch (e) {
    return { txid: null, note: String((e as Error).message || e).slice(0, 140) };
  }
}

/** שידור Hive — חתימה מקומית + broadcast_transaction גולמי (העבר מדויק של הצי) */
export async function hiveBroadcast(
  ops: GrapheneOperation[],
  wif: string
): Promise<{ txid: string | null; accepted: boolean; note?: string }> {
  try {
    const signed = await signGrapheneTx(HIVE_RPC, HIVE_CHAIN_ID, ops, wif);
    await rpcV4(HIVE_RPC, "condenser_api.broadcast_transaction", [signed]);
    // השידור התקבל — ל-steem-js אין id מוחזר כאן; ההיסטוריה תאשר
    return { txid: null, accepted: true, note: "broadcast-accepted (await history confirm)" };
  } catch (e) {
    return { txid: null, accepted: false, note: String((e as Error).message || e).slice(0, 140) };
  }
}

/** איתור ה-op שלנו בהיסטוריית החשבון — ההיסטוריה השופטת היחידה */
export async function findInHistory(
  endpoint: string,
  account: string,
  opId: string,
  expectAt: string,
  pages = 4,
  limit = 100
): Promise<string | null> {
  let start = -1;
  for (let p = 0; p < pages; p++) {
    const hist = await rpcV4<Array<[number, { op?: [string, { id?: string; json?: string }]; trx_id?: string }]>>(
      endpoint,
      "condenser_api.get_account_history",
      [account, start, limit]
    ).catch(() => null);
    if (!Array.isArray(hist) || !hist.length) break;
    let lowest = Infinity;
    for (const [, e] of hist) {
      const op = e.op;
      if (!op || op[0] !== "custom_json") continue;
      if (op[1].id !== opId) continue;
      try {
        const pl = JSON.parse(String(op[1].json || "{}")) as { at?: string };
        if (pl.at === expectAt) return e.trx_id || null;
      } catch {
        /* skip */
      }
    }
    for (const [idx] of hist) if (idx < lowest) lowest = idx;
    if (lowest === Infinity || lowest <= 1) break;
    start = Math.max(1, lowest - 1);
  }
  return null;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
