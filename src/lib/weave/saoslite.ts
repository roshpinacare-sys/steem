// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · saoslite - SAOS-LIVE v1: המטבע החי של הרשת (Task 29)
//
// מה המודול הזה עושה בכל פעימת לב:
//   1. קורא את ספר הטוקנים מהשרשרת הציבורית (חסר-מפתח לחלוטין):
//      כל custom_json עם op id `saos.weave.live.v1` מחשבונות הרשת
//      (קו העדות cashmachine + המפעיל headcorner) - בסדר חסין.
//   2. מנכיש את הג'נזיס (ענן בלבד): אם SAOS טרם נפרש על השרשרת -
//      בונה את שלוש פעולות הג'נזיס (רישום האוצר · פריסת החוזה ·
//      הטבעה ראשונה 126,682 SAOS המשקפת את v0 בדיוק 1:1), חתומות
//      במפתח ה-posting של קו העדות (WEAVE_STEEM_WIF - אותו מפתח
//      שמעגן את כל checkpoints), ומשדר טרנזאקציה אחת אטומית.
//   3. מקפל את הספר (המנוע: console/saos-live.js - אותו קוד בדיוק
//      רץ בדפדפן של כל משתמש; אפס הסתעפות, אפס העתקה) ומאמת
//      כל חתימה מחדש.
//   4. מפרסם את saos-live.json לקונסולה הציבורית (WEAVE_OPS_PAT,
//      שער-סודות על התוכן, פרסום רק בשינוי) - הצומת של כל דפדפן.
//   5. מעיד על שינוי מצב: stateRoot חדש · אימות SAOSLIVE חתום
//      + checkpoint שמכסה אותו - העוגנים יעידו ב-$0.
//
// דוקטרינת האמון (תווית אמת מלאה): ה-relayer הוא תעבורה. הסמכות
// היא החתימה הפנימית של בעל הארנק. הספר ציבורי, הקיפול דטרמיניסטי,
// וכל צומת - דפדפן או ענן - מגיע לאותו stateRoot מאותן פעולות.
// ─────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import { rpcV4, STEEM_RPC_NODES, steemBroadcast, steemRcGate } from "@/lib/weave/graphene";
import type { GrapheneOperation } from "steem";
import { db } from "@/lib/db";
import { appendAttestation } from "@/lib/weave/ledger";
import { createCheckpointNow } from "@/lib/weave/beat";
import { secretGate, filterKnownHashes } from "../../../scripts/weave-gate";
// r144-g2 — תור-הריליי הריבוני: מעטפות wallet.create חתומות-בידי-משתמשים
// שממתינות לשידור-תעבורה (append-only, אפס חומר-מפתח)
import { readRelayQueue, markRelayQueueEntry } from "./saos-relay-queue";

export const SAOS_LIVE_OP_ID = "saos.weave.live.v1";
const WITNESS_ACCOUNT = (process.env.WEAVE_STEEM_ACCOUNT || "cashmachine").toLowerCase();
const OPERATOR_ACCOUNT = (process.env.WEAVE_OPERATOR_ACCOUNT || "headcorner").toLowerCase();
/** שני המשדרים הרשומים כרגע - סדר קבוע לקנון הקריאה */
const RELAY_ACCOUNTS = [WITNESS_ACCOUNT, OPERATOR_ACCOUNT];

const OWNER = process.env.WEAVE_OWNER || "roshpinacare-sys";
const CONSOLE_REPO = `${OWNER}/Console`;
const ROOT = path.resolve(__dirname, "..", "..", "..");
const STATE_PATH = path.join(ROOT, "sovereign", "saos-live-state.json");
// R57 (אמת-אחת): שם הקובץ "saos-live.json" שמור מעתה לספר הציבורי שמתפרסם
// ל-Pages בלבד. קובץ המצב הפנימי של הדמון (יומן ג'נזיס + seen) נושא שם
// משלו — שני תפקידים שונים לא יתחלקו עוד שם זהה (נתפס ב-truth-gate G5).
const STATE_PATH_LEGACY = path.join(ROOT, "sovereign", "saos-live.json");
// הגירה חד-פעמית: קובץ ישן בשם השמור מועבר לשם החדש
if (!fs.existsSync(STATE_PATH) && fs.existsSync(STATE_PATH_LEGACY)) {
  try {
    fs.renameSync(STATE_PATH_LEGACY, STATE_PATH);
    console.log("[saos-live] מצב הדמון הועבר לשם החדש: saos-live-state.json (השם saos-live.json שמור לספר הציבורי)");
  } catch {
    /* ההמשך יקרא את הישן — ההגירה תחזור בריצה הבאה */
  }
}
const PAGE = 100;
const MAX_PAGES = 12;

/* ── קובץ מצב מקומי: יומן ג'נזיס + זמני צפייה ראשונה לפעולות ── */
interface SaosLiveStateFile {
  format: "saos-live-state-v1";
  genesis: { attempted: boolean; done: boolean; txid?: string; treasury?: string; broadcastAt?: string; note?: string };
  seen: Record<string, string>;
  lastStateRoot: string | null;
  updatedAt: string;
}
function loadStateFile(): SaosLiveStateFile {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as SaosLiveStateFile;
    if (raw.format === "saos-live-state-v1") {
      raw.genesis = raw.genesis || { attempted: false, done: false };
      raw.seen = raw.seen || {};
      return raw;
    }
  } catch {
    /* נולד עכשיו */
  }
  return { format: "saos-live-state-v1", genesis: { attempted: false, done: false }, seen: {}, lastStateRoot: null, updatedAt: new Date(0).toISOString() };
}
function saveStateFile(st: SaosLiveStateFile): void {
  st.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(st, null, 2) + "\n");
}

/* ── קריאת הספר מהשרשרת הציבורית - חסרת-מפתח לחלוטין ── */
export interface LiveEnvelope {
  env: Record<string, unknown>;
  txid: string;
  block: number | null;
  trxInBlock: number | null;
  account: string;
}

export async function readLiveEnvelopes(): Promise<{ envelopes: LiveEnvelope[]; node: string }> {
  let lastErr: unknown = null;
  for (const node of STEEM_RPC_NODES) {
    try {
      const out: LiveEnvelope[] = [];
      for (const account of RELAY_ACCOUNTS) {
        // R104 — חוק-הגילוי: שאילתות-העוגן (start=-1) בצומת הציבורי נצפו
        // מוגשות מעותק-קאש מיושן לפי מפתח-מדויק (start,limit): אופ ממשי על
        // השרשרת נעלם מהתשובה בעודו כלול בבלוק — נמדד חי 2026-09-23, שוב
        // ושוב, על מפתחות שונים. לכן: גישוש כפול בגבולות-אקראיים (מקסימום
        // אינדקס מנצח — שני עותקים מיושנים שונים בבת-אחת זה נדירות-מדידה)
        // ועימוד בגבולות מרוצדים — אף מפתח-קאש לא נשאר רעיל לאורך זמן.
        // השרשרת היא השופט; הקאש הוא תחבורה בלבד.
        let start = -1;
        {
          const lim1 = 2 + Math.floor(Math.random() * 7); // 2..8
          const lim2 = 2 + Math.floor(Math.random() * 7); // 2..8 — מפתח שונה תמיד
          let newest = -1;
          for (const lim of new Set([lim1, lim2])) {
            const probe = await rpcV4<Array<[number, unknown]>>(
              node, "condenser_api.get_account_history", [account, -1, lim],
            );
            if (Array.isArray(probe) && probe.length) {
              const n = probe[probe.length - 1][0];
              if (typeof n === "number" && n > newest) newest = n;
            }
          }
          if (newest >= 0) start = newest;
        }
        if (start < 0) continue; // אין היסטוריה כלל — רגל שקטה בכנות
        for (let p = 0; p < MAX_PAGES; p++) {
          // עימוד מרוצד: 95..100 — מפתחות-קאש מתפזרים, עותק-מיושן אחד
          // לא מסוגל להרעיל את כל הסריקה
          const pageLim = PAGE - Math.floor(Math.random() * 6);
          const hist = await rpcV4<Array<[number, { trx_id: string; block: number; trx_in_block: number; op?: [string, Record<string, unknown>] }]>>(
            node,
            "condenser_api.get_account_history",
            [account, start, pageLim],
          );
          if (!Array.isArray(hist) || !hist.length) break;
          let oldest = Infinity;
          for (const [idx, entry] of hist) {
            if (typeof idx === "number") oldest = Math.min(oldest, idx);
            const op = entry && entry.op;
            if (!op || op[0] !== "custom_json") continue;
            const body = op[1] as { id?: string; json?: string; required_posting_auths?: string[] } | undefined;
            if (!body || body.id !== SAOS_LIVE_OP_ID) continue;
            // רק מהחשבון שמשדר - לא התחזות ב-required_posting_auths אחר
            if (!Array.isArray(body.required_posting_auths) || !body.required_posting_auths.includes(account)) continue;
            try {
              const env = JSON.parse(String(body.json || "{}")) as Record<string, unknown>;
              out.push({ env, txid: String(entry.trx_id || ""), block: typeof entry.block === "number" ? entry.block : null, trxInBlock: typeof entry.trx_in_block === "number" ? entry.trx_in_block : null, account });
            } catch {
              /* ג'ייסון שבור - הקיפול ידחה אותו בכנות */
            }
          }
          if (oldest === Infinity || oldest <= 1) break;
          start = Math.max(1, oldest - 1);
        }
      }
      // סדר חסין-קנוני: בלוק · מיקום בבלוק · שם חשבון (דטרמיניסטי בכל מכונה)
      out.sort((a, b) => (a.block ?? 0) - (b.block ?? 0) || (a.trxInBlock ?? 0) - (b.trxInBlock ?? 0) || a.account.localeCompare(b.account));
      return { envelopes: out, node: new URL(node).hostname };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`קריאת ספר SAOS-LIVE נכשלה בכל הצמתים: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

/* ── עדיפות עוגן הליבה (R27, נולד ממדידת 2026-09-17): כשעוגן הליבה
 * רעב (גיל מעל הסף), כל שידור אוטומטי אחר של הרשת מהחשבון נכנע -
 * תקציב ה-RC של אותה פעימה שייך לעוגן. ההיסטוריה שהולידה את החוק:
 * הג'נזיס (deploy 15:08Z, mint 00:11Z) צרך את המנה המתאוששת פעמיים
 * בזמן שקו העוגן המתין בכנות מעל הרצפה - והרשת נשארה STALE 32.7
 * שעות. אוטומטים נכנעים; פקודת מפעיל מפורשת לא נכנעת (המפעיל
 * דיבר). הקריאה חסרת-מפתח לחלוטין - היסטוריה ציבורית בלבד. ── */
export const CORE_OP_ID = "saos.weave.core.v1";
export const CORE_PRIORITY_H = Number(process.env.WEAVE_CORE_PRIORITY_H || 12);

export async function readCoreAnchorAge(): Promise<{ ok: boolean; ageHours?: number; lastAt?: string; reason?: string }> {
  let lastErr: unknown = null;
  for (const node of STEEM_RPC_NODES) {
    try {
      // R104 — חוק-הגילוי (אותו תיקון כמו readLiveEnvelopes): גילוי-אינדקס
      // בשאילתה זעירה ואז start מפורש — עמידות לעותקי-קאש מיושנים של
      // שאילתת-העוגן (-1, 100) בצמתים הציבוריים.
      const probe = await rpcV4<Array<[number, unknown]>>(
        node, "condenser_api.get_account_history", [WITNESS_ACCOUNT, -1, 1],
      );
      const newest = Array.isArray(probe) && probe.length ? probe[probe.length - 1][0] : -1;
      if (typeof newest !== "number" || newest < 0) continue;
      const hist = await rpcV4<Array<[number, { timestamp?: string; op?: [string, Record<string, unknown>] }]>>(
        node,
        "condenser_api.get_account_history",
        [WITNESS_ACCOUNT, newest, 100],
      );
      if (!Array.isArray(hist)) continue;
      let lastAt = "";
      for (const [, entry] of hist) {
        const op = entry && entry.op;
        if (!op || op[0] !== "custom_json") continue;
        const body = op[1] as { id?: string; required_posting_auths?: string[] } | undefined;
        if (!body || body.id !== CORE_OP_ID) continue;
        if (!Array.isArray(body.required_posting_auths) || !body.required_posting_auths.includes(WITNESS_ACCOUNT)) continue;
        const ts = String(entry.timestamp || "");
        if (ts && ts > lastAt) lastAt = ts; // חיתוך ISO - השוואה מילולית בטוחה
      }
      if (!lastAt) return { ok: true, ageHours: 9999, reason: "core op not found in last 100 ops" };
      const ageH = (Date.now() - Date.parse(lastAt + "Z")) / 3_600_000;
      if (!Number.isFinite(ageH)) return { ok: false, reason: `unparsable core timestamp: ${lastAt}` };
      return { ok: true, ageHours: ageH, lastAt };
    } catch (e) {
      lastErr = e;
    }
  }
  return { ok: false, reason: `core-age unreadable: ${lastErr instanceof Error ? lastErr.message.slice(0, 80) : String(lastErr)}` };
}

/* ── הנחת הג'נזיס (ענן בלבד) - מדורגת: פעולה אחת לפעימה ──
 * נלמד במדידה חיה (22:15Z): השרשרת דחתה טרנזאקציית 3-פעולות במחיר
 * RC שוק של 444M - בעוד המנה החיה 200M. התיקון הריבוני: לא לחכות
 * ל-20 שעות למנה שלמה, אלא להניח את הג'נזיס בשלבים - פעולה אחת
 * לכל פעימה, כל עוד ה-RC מאפשר: רישום האוצר · פריסת החוזה · ההטבעה.
 * כל שלב נבדק מול הקיפול של מה שכבר על השרשרת - אידמפוטנטי מטבעו. */
interface GenesisFoldState {
  wallets: Record<string, unknown>;
  tokens: Record<string, unknown>;
  supply: Record<string, bigint>;
}
async function ensureGenesis(fold: GenesisFoldState, st: SaosLiveStateFile): Promise<{ broadcast: boolean; note: string; txid?: string; treasury?: string }> {
  const wif = (process.env.WEAVE_STEEM_WIF || "").trim();
  if (!wif) return { broadcast: false, note: "אין WEAVE_STEEM_WIF בסביבה - דילוג-כנה (הג'נזיס מונח רק מהענן)" };
  if (st.genesis.attempted && st.genesis.broadcastAt && Date.now() - Date.parse(st.genesis.broadcastAt) < 10 * 60 * 1000) {
    return { broadcast: false, note: "ניסיון ג'נזיס אחרון לפני פחות מ-10 דק' - המתנה כנה להיכללות בבלוק" };
  }

  try {
    const GateCrypto = await import("../../../console/gate-crypto.js");
    const SaosLive = await import("../../../console/saos-live.js");

    // האוצר = הזהות שנגזרת ממפתח ה-posting של קו העדות - ניתן לאימות ציבורי מהשרשרת
    const priv = await GateCrypto.wifToPriv(wif);
    const pubSTM = await GateCrypto.pubToSTM(GateCrypto.privToPubBytes(priv));
    const { treasury, ops } = await SaosLive.buildGenesisOps(priv, pubSTM);

    // מה כבר על השרשרת? (מהקיפול - השרשרת היא השופט)
    const registered = Boolean(fold.wallets[treasury]);
    const deployed = Boolean(fold.tokens[SaosLive.SAOS_GENESIS.symbol]);
    const minted = (fold.supply[SaosLive.SAOS_GENESIS.symbol] ?? BigInt(0)) >= BigInt(SaosLive.SAOS_GENESIS.initialMint);
    if (registered && deployed && minted) {
      st.genesis.done = true;
      st.genesis.treasury = treasury;
      if (!st.genesis.note || !st.genesis.note.includes("נמצא")) st.genesis.note = "הג'נזיס נמצא על השרשרת (אומת בקיפול)";
      return { broadcast: false, note: "הג'נזיס כבר על השרשרת", treasury };
    }
    const step = !registered ? "רישום האוצר" : !deployed ? "פריסת החוזה" : "ההטבעה הראשונה";
    const nextOp = !registered ? ops[0] : !deployed ? ops[1] : ops[2];

    // עדיפות עוגן הליבה לפני שער ה-RC (R27): אוטומט נכנע כשהעוגן רעב.
    // אם הגיל בלתי-קריא - גם כן נכנעים: לא מוציאים תקציב בעלטה.
    const core = await readCoreAnchorAge();
    if (!core.ok) {
      return { broadcast: false, note: `דילוג-כנה - גיל עוגן הליבה בלתי-קריא (${core.reason ?? "?"}) - לא מוציאים תקציב בעלטה` };
    }
    if ((core.ageHours ?? 0) > CORE_PRIORITY_H) {
      return { broadcast: false, note: `דילוג-כנה - עדיפות עוגן הליבה (גיל ${(core.ageHours ?? 0).toFixed(1)} ש' > ${CORE_PRIORITY_H} ש') - הג'נזיס נכנע לעוגן` };
    }

    // שער ה-RC לפני שידור - אותה משמעת כמו קווי העוגן
    const gate = await steemRcGate(WITNESS_ACCOUNT);
    if (!gate.ok) {
      return { broadcast: false, note: `דילוג-כנה - RC נמוך (${gate.reason ?? "gated"}) · הבא: ${step}` };
    }

    const txOps: GrapheneOperation[] = [[
      "custom_json",
      {
        required_auths: [],
        required_posting_auths: [WITNESS_ACCOUNT],
        id: SAOS_LIVE_OP_ID,
        json: JSON.stringify(nextOp),
      },
    ]] as GrapheneOperation[];

    const res = await steemBroadcast(txOps, wif);
    st.genesis.attempted = true;
    st.genesis.broadcastAt = new Date().toISOString();
    st.genesis.treasury = treasury;
    st.genesis.note = res.txid ? `${step} שודרה (tx ${res.txid.slice(0, 14)}…) - ממתין להיכללות` : `שידור נכשל: ${res.note ?? "?"} · הבא: ${step}`;
    if (res.txid) st.genesis.txid = res.txid;
    return { broadcast: true, txid: res.txid ?? undefined, treasury, note: st.genesis.note };
  } catch (e) {
    st.genesis.attempted = true;
    st.genesis.broadcastAt = new Date().toISOString();
    st.genesis.note = `שגיאה: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`;
    return { broadcast: false, note: st.genesis.note };
  }
}

/* ── שטיפת תור-הריליי (r144-g2): מעטפות wallet.create חתומות-בידי
 * משתמשים שהריליי לא שידר ישירות (שער-עוגן/שער-RC/אין מפתח-תעבורה
 * בסביבה). אותה משמעת בדיוק כמו הג'נזיס: עדיפות עוגן-הליבה קודם,
 * שער-RC, תעבורה בלבד דרך קו-העדות, תקציב-גנוע אחרי שידור-ג'נזיס,
 * ולכל היותר 3 מעטפות לפעימה. השרשרת היא השופט: כל מעטפה נשפטת
 * מחדש מול המצב החי — מה שנדחה נרשם rejected בכנות, רשומות
 * test:true לעולם לא משודרות, וכלום לעולם לא נמחק (append-only). ── */
const RELAY_FLUSH_MAX = 3;
async function flushRelayQueue(judgeEnvs: Record<string, unknown>[], genesisBroadcast: boolean): Promise<{ flushed: number; rejected: number; note: string }> {
  const q = readRelayQueue();
  const pending = q.entries.filter((e) => e.status === "queued" && !e.test && e.env?.k === "wallet.create");
  if (!pending.length) return { flushed: 0, rejected: 0, note: "תור-הריליי פנוי" };
  if (genesisBroadcast) return { flushed: 0, rejected: 0, note: `דילוג-כנה - הג'נזיס דיבר הפעימה הזו (תקציב-RC אחד לחשבון) · ${pending.length} בתור` };
  const core = await readCoreAnchorAge();
  if (!core.ok || (core.ageHours ?? 0) > CORE_PRIORITY_H) {
    return { flushed: 0, rejected: 0, note: `דילוג-כנה - עדיפות עוגן-הליבה (${!core.ok ? core.reason ?? "?" : `גיל ${(core.ageHours ?? 0).toFixed(1)} ש'`}) · ${pending.length} בתור` };
  }
  const batch = pending.slice(0, RELAY_FLUSH_MAX);
  const wif = (process.env.WEAVE_STEEM_WIF || "").trim();
  if (!wif) return { flushed: 0, rejected: 0, note: `אין WEAVE_STEEM_WIF בסביבה - התור ממתין לענן · ${pending.length} בתור` };

  const SaosLive = await import("../../../console/saos-live.js");
  // השופט: קיפול אחד של הספר החי + המעטפות המועמדות בתורו -
  // סמנטיקת סדר מדויקת (dup-id/pub-taken/wallet-exists נשפטים כמו על השרשרת)
  const judged = await SaosLive.fold([...judgeEnvs, ...batch.map((e) => e.env)]);
  let flushed = 0;
  let rejected = 0;
  for (const entry of batch) {
    const bad = (judged.invalid ?? []).find((x) => x.id === entry.id);
    if (bad && bad.err !== "wallet-exists") {
      rejected++;
      markRelayQueueEntry(entry.id, { status: "rejected", note: `FOLD-REJECT: ${bad.err}` });
      continue;
    }
    if (bad) {
      // wallet-exists = המטרה הושגה בדרך אחרת - רישום כנה, אפס שידור
      markRelayQueueEntry(entry.id, { status: "registered", note: "כבר רשום על השרשרת (נמצא בקיפול)" });
      continue;
    }
    const gate = await steemRcGate(WITNESS_ACCOUNT);
    if (!gate.ok) {
      markRelayQueueEntry(entry.id, { note: `ממתין - RC נמוך (${gate.reason ?? "gated"})` });
      continue; // נשאר queued - הפעימה הבאה תנסה שוב
    }
    const txOps: GrapheneOperation[] = [[
      "custom_json",
      {
        required_auths: [],
        required_posting_auths: [WITNESS_ACCOUNT],
        id: SAOS_LIVE_OP_ID,
        json: JSON.stringify(entry.env),
      },
    ]] as GrapheneOperation[];
    const res = await steemBroadcast(txOps, wif);
    if (res.txid) {
      flushed++;
      markRelayQueueEntry(entry.id, { status: "flushed", txid: res.txid, broadcastAt: new Date().toISOString(), note: "שוטף מהתור בפרסום-הקיפול" });
    } else {
      markRelayQueueEntry(entry.id, { note: `שידור נכשל (${(res.note ?? "?").slice(0, 50)}) - ננסה בפעימה הבאה` });
    }
  }
  return { flushed, rejected, note: `שוטפו ${flushed} · נדחו ${rejected} · ${pending.length - flushed - rejected} נותרו בתור` };
}

/* ── פרסום saos-live.json לריפו הציבורי - כמו המראה: שער + שינוי-בלבד ── */
async function publishLiveFile(payload: Record<string, unknown>): Promise<{ published: boolean; reason: string; bytes?: number }> {
  const text = JSON.stringify(payload, null, 2) + "\n";
  const leak = secretGate(filterKnownHashes(text));
  if (leak) throw new Error(`saos-live.json נחסם בשער-הסודות: ${leak} - לא מפורסם כלום`);

  const pat = process.env.WEAVE_OPS_PAT || "";
  if (!pat) return { published: false, reason: "אין WEAVE_OPS_PAT בסביבה - דילוג-כנה (הפרסום רק מהענן)" };

  const api = async (method: string, url: string, body?: unknown) => {
    const res = await fetch(`https://api.github.com${url}`, {
      method,
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body ? JSON.stringify(body) : undefined,
      // R112 — law of the bounded wait: no fetch without a deadline
      signal: AbortSignal.timeout(30_000),
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  };

  const cur = await api("GET", `/repos/${CONSOLE_REPO}/contents/saos-live.json?ref=main`);
  if (cur.status === 200 && cur.json && typeof cur.json.content === "string") {
    const curText = Buffer.from(cur.json.content, "base64").toString("utf8");
    if (curText.trim() === text.trim()) return { published: false, reason: "הספר החי כבר עדכני - אין שינוי לפרסם", bytes: text.length };
  }
  const put = await api("PUT", `/repos/${CONSOLE_REPO}/contents/saos-live.json`, {
    message: `saos-live: ${(payload.stateRoot as string || "").slice(0, 16)} · ${(payload.ops as unknown[] || []).length} ops · ${((payload.state as Record<string, Record<string, unknown>>)?.wallets ? Object.keys((payload.state as Record<string, Record<string, unknown>>).wallets).length : 0)} wallets · sovereign live ledger`,
    content: Buffer.from(text, "utf8").toString("base64"),
    sha: cur.status === 200 && cur.json ? String(cur.json.sha || "") : undefined,
    branch: "main",
  });
  if (put.status !== 200 && put.status !== 201) {
    return { published: false, reason: `פרסום נכשל (HTTP ${put.status}) - ${String(put.json?.message || "").slice(0, 80)}` };
  }
  return { published: true, reason: "פורסם", bytes: text.length };
}

/* ── סיכום פעולה לתצוגה ── */
function opSummary(env: Record<string, unknown>): string {
  const k = String(env.k || "");
  const n = (x: unknown) => Number(x || 0).toLocaleString("en");
  if (k === "wallet.create") return `רישום ארנק${env.nick ? ` "${env.nick}"` : ""} ${String(env.by || "").slice(0, 12)}…`;
  if (k === "token.deploy") return `פריסת חוזה ${env.symbol} (תקרה ${n(env.maxSupply)})`;
  if (k === "token.mint") return `הטבעת ${n(env.amount)} ${env.symbol} · ${String(env.to || "").slice(0, 12)}…`;
  if (k === "token.transfer") return `${n(env.amount)} ${env.symbol} · ${String(env.to || "").slice(0, 12)}…`;
  if (k === "token.burn") return `שריפת ${n(env.amount)} ${env.symbol}`;
  if (k === "deposit.claim") return `תביעת הפקדה ${env.amt} ${env.cur}`;
  if (k === "deposit.credit") return `זיכוי הפקדה ${n(env.saos)} SAOS עבור ${env.amt} ${env.cur}`;
  if (k === "dex.offer") return `הצעת מכירה ${n(env.units)} SAOS במחיר ${env.price} ${env.cur}`;
  if (k === "dex.cancel") return `ביטול הצעה`;
  if (k === "dex.fill") return `מילוי הצעה: ${n(env.units)} SAOS -> ${String(env.to || "").slice(0, 12)}…`;
  if (k === "reward.pay") return `תגמול ${n(env.amount)} SAOS -> ${String(env.to || "").slice(0, 12)}…`;
  if (k === "cfg.addr") return `כתובת הפקדה פורסמה ל${env.cur}`;
  if (k === "cfg.rate") return `שער ${env.pair} = ${env.price}`;
  return k;
}

/** שדות נתונים לתצוגת הציבור לפי סוג - הספר הפתוח */
function opData(env: Record<string, unknown>): Record<string, unknown> | null {
  const k = String(env.k || "");
  const pick = (keys: string[]) => Object.fromEntries(keys.filter((x) => env[x] !== undefined).map((x) => [x, env[x]]));
  if (k === "deposit.claim") return pick(["cur", "amt", "ref"]);
  if (k === "deposit.credit") return pick(["cur", "amt", "saos", "to", "ref", "claimId", "note"]);
  if (k === "dex.offer") return pick(["cur", "units", "price"]);
  if (k === "dex.fill") return pick(["offerId", "to", "units", "paid", "ref"]);
  if (k === "dex.cancel") return pick(["offerId"]);
  if (k === "reward.pay") return pick(["to", "amount", "note"]);
  if (k === "cfg.addr") return pick(["cur", "addr", "memo"]);
  if (k === "cfg.rate") return pick(["pair", "price"]);
  if (k === "token.transfer") return pick(["symbol", "to", "amount"]);
  if (k === "token.mint") return pick(["symbol", "to", "amount"]);
  return null;
}

export interface SaosLiveResult {
  ok: boolean;
  ops: number;
  valid: number;
  wallets: number;
  tokens: number;
  stateRoot: string;
  attested: boolean;
  attSeq?: number;
  checkpoint?: { index: number; root: string };
  genesisNote: string;
  publishNote: string;
  node: string;
}

/**
 * השלב שהלב מריץ בכל פעימה: קריאה · ג'נזיס (ענן) · קיפול · פרסום · עדות-על-שינוי.
 * attested=true מעיר את הרשת (עוקף את נסיגת SANDBOX-ALIVE) - המטבע דיבר.
 */
export async function processSaosLive(ctx: { runner: string; cloudAgentId: string; gitHead: string; repoSlug: string; runUrl?: string }): Promise<SaosLiveResult> {
  const st = loadStateFile();
  const { envelopes, node } = await readLiveEnvelopes();

  const SaosLive = await import("../../../console/saos-live.js");
  let res = await SaosLive.fold(envelopes.map((e) => e.env));
  let judgeEnvs: Record<string, unknown>[] = envelopes.map((e) => e.env);

  // הנחת הג'נזיס - מדורג: רק הפעולה החסרה (השרשרת היא השופט)
  const gen = await ensureGenesis(res.state, st);
  if (gen.broadcast && gen.txid) {
    // המתנה קצרה להיכללות ואז קריאה חוזרת - הפעימה הבאה תאסוף אם פספסנו
    await new Promise((r) => setTimeout(r, 9000));
    const again = await readLiveEnvelopes().catch(() => null);
    if (again) {
      judgeEnvs = again.envelopes.map((e) => e.env);
      res = await SaosLive.fold(judgeEnvs);
    }
  }

  // r144-g2 — שטיפת תור-הריליי לפני הפרסום: מה שהוצא מהתור כבר על
  // השרשרת ויאסף בקריאה הבאה; הכנות נשמרת ברשומות התור עצמן.
  let relayFlush: { flushed: number; rejected: number; note: string } = { flushed: 0, rejected: 0, note: "לא רץ" };
  try {
    relayFlush = await flushRelayQueue(judgeEnvs, gen.broadcast);
    if (relayFlush.flushed || relayFlush.rejected) console.log(`[saos-live] ריליי: ${relayFlush.note}`);
  } catch (flErr) {
    relayFlush = { flushed: 0, rejected: 0, note: `שטיפה נדחתה: ${flErr instanceof Error ? flErr.message.slice(0, 80) : String(flErr)}` };
  }
  // השלמת הג'נזיס - רק מהקיפול: אוצר רשום + חוזה פרוס + אספקה מלאה
  if (res.state.tokens?.SAOS && (res.state.supply?.SAOS ?? BigInt(0)) >= BigInt(SaosLive.SAOS_GENESIS.initialMint)) {
    st.genesis.done = true;
  }

  // זמני צפייה ראשונה (תווית אמת: "נצפה בענן", לא זמן השרשרת)
  const seen = st.seen || {};
  for (const e of envelopes) {
    const id = String(e.env.id ?? "");
    if (id && !seen[id]) seen[id] = new Date().toISOString();
  }
  st.seen = seen;

  const state = res.state as {
    wallets: Record<string, { pub: string; nick: string | null; at: string | null; txid: string | null }>;
    tokens: Record<string, { name: string; decimals: number; maxSupply: string; issuer: string; at: string | null; txid: string | null }>;
  };
  const saosSupply = String(res.supplyCanon?.SAOS ?? "0");
  const saosDisplay = SaosLive.fmt(saosSupply, state.tokens?.SAOS?.decimals ?? 3);

  const opsList = envelopes.map((e) => ({
    id: String(e.env.id ?? "?"),
    k: String(e.env.k ?? "?"),
    by: String(e.env.by ?? ""),
    at: seen[String(e.env.id ?? "")] ?? null,
    txid: e.txid,
    block: e.block,
    summary: opSummary(e.env),
    d: opData(e.env),
  }));

  const payload = {
    format: "saos-live-v1",
    generatedAt: new Date().toISOString(),
    protocol: SaosLive.PROTOCOL,
    stateRoot: res.stateRoot,
    genesis: {
      done: st.genesis.done,
      treasury: st.genesis.treasury ?? null,
      txid: st.genesis.txid ?? null,
      symbol: SaosLive.SAOS_GENESIS.symbol,
      initialMint: SaosLive.SAOS_GENESIS.initialMint,
      maxSupply: SaosLive.SAOS_GENESIS.maxSupply,
      note: SaosLive.SAOS_GENESIS.note,
    },
    state: {
      wallets: state.wallets,
      tokens: state.tokens,
      balances: res.balCanon,
      supply: res.supplyCanon,
      claims: res.claimsCanon ?? {},
      offers: res.offersCanon ?? {},
      cfg: res.cfgCanon ?? { addrs: {}, rates: {} },
      rewardsPaid: res.state?.rewardsPaid != null ? String(res.state.rewardsPaid) : "0",
      treasury: res.state?.treasury ?? null,
    },
    ops: opsList,
    // r144-g2 — הצהרת-הריליי של הבית: כתובת אופציונלית (WEAVE_PUBLIC_URL)
    // לשימוש דף-הארנק הציבורי + מצב התור המקומי. אין כאן כתובת = אין ריליי
    // מוכר, והדף אומר זאת בכנות (אפס-המצאה).
    relay: {
      url: (process.env.WEAVE_PUBLIC_URL || "").trim() || null,
      queued: readRelayQueue().entries.filter((e) => e.status === "queued" && !e.test).length,
      lastFlush: relayFlush.note,
    },
    invalid: res.invalid,
    verify: {
      replayed: envelopes.length,
      valid: res.valid,
      readFrom: node,
      engine: "console/saos-live.js (same code as every browser)",
    },
    truthLabel: "REAL - deterministic fold of public-chain custom_json ops; every signature re-verified; relayer = transport only",
  };

  // פרסום לקונסולה - הצומת של כל דפדפן
  let publishNote = "";
  try {
    const pub = await publishLiveFile(payload);
    publishNote = pub.published ? `פורסם (${Math.round((pub.bytes || 0) / 1024)}KB)` : pub.reason;
  } catch (pubErr) {
    publishNote = `נדחה: ${pubErr instanceof Error ? pubErr.message.slice(0, 90) : String(pubErr)}`;
  }

  // עדות על שינוי מצב בלבד - הספר לא מציף את החותמת, הוא מעיד על אמת מתקדמת
  let attested = false;
  let attSeq: number | undefined;
  let checkpoint: { index: number; root: string } | undefined;
  if (res.stateRoot && res.stateRoot !== st.lastStateRoot) {
    const last = await db.attestation.findFirst({ where: { claimType: "SAOSLIVE" }, orderBy: { seq: "desc" } });
    const lastRoot = last ? /stateRoot=([0-9a-f]{64})/.exec(last.evidence || "")?.[1] : undefined;
    if (lastRoot !== res.stateRoot) {
      const first = !last;
      const claim = first
        ? `SAOS-LIVE v1 נולד: ספר הטוקנים החי על השרשרת הציבורית - ${res.valid} פעולות תקפות, ${Object.keys(state.wallets).length} ארנקים, ${Object.keys(state.tokens).length} חוזים, אספקת SAOS ${saosDisplay} (משקף את SAOS-NET v0 בדיוק 1:1)`
        : `SAOS-LIVE v1 התקדם: stateRoot חדש ${res.stateRoot.slice(0, 16)}… - ${res.valid} פעולות תקפות, ${Object.keys(state.wallets).length} ארנקים, ${Object.keys(state.tokens).length} חוזים, אספקת SAOS ${saosDisplay}`;
      const evidence = [
        `protocol=${SaosLive.PROTOCOL}`,
        `opId=${SAOS_LIVE_OP_ID}`,
        `stateRoot=${res.stateRoot}`,
        `ops=${res.valid}/${envelopes.length}`,
        `wallets=${Object.keys(state.wallets).length}`,
        `tokens=${Object.keys(state.tokens).length}`,
        `saosSupply=${saosSupply}`,
        st.genesis.txid ? `genesisTxid=${st.genesis.txid}` : null,
        st.genesis.treasury ? `treasury=${st.genesis.treasury}` : null,
        st.genesis.txid ? `explorer=https://steemscan.com/transaction/${st.genesis.txid}` : null,
        `fold=console/saos-live.js (deterministic, same code in every browser)`,
        `relayers=${RELAY_ACCOUNTS.map((a) => "@" + a).join("+")} (posting, transport only)`,
        `readFrom=${node}`,
        `runner=${ctx.runner}`,
        `commit=${ctx.gitHead}`,
        ctx.runUrl ? `run=${ctx.runUrl}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      const att = await appendAttestation({ agentId: ctx.cloudAgentId, claim, claimType: "SAOSLIVE", evidence });
      attested = true;
      attSeq = att.seq;
      console.log(`[saos-live] אימות SAOSLIVE att${att.seq} · stateRoot ${res.stateRoot.slice(0, 16)}… · ${res.valid} פעולות`);
      const cp = await createCheckpointNow();
      if (cp) {
        checkpoint = { index: cp.index, root: cp.root };
        console.log(`[saos-live] checkpoint #${cp.index} מכסה את הספר החי (att ${cp.attFrom}..${cp.attTo})`);
      }
    }
  }

  st.lastStateRoot = res.stateRoot || null;
  saveStateFile(st);

  return {
    ok: true,
    ops: envelopes.length,
    valid: res.valid,
    wallets: Object.keys(state.wallets).length,
    tokens: Object.keys(state.tokens).length,
    stateRoot: res.stateRoot,
    attested,
    attSeq,
    checkpoint,
    genesisNote: gen.note,
    publishNote,
    node,
  };
}
