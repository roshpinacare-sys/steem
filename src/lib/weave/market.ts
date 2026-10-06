// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Market — שוק האמת (השוק החכם של הרשת)
//
// הסחורה: הכרעה עתידית של טענות מדידות. השופט: המדידה — של
// הרשת עצמה (PlanStage שנסגר, Checkpoint שנוצר, מספר אימותי
// ANCHOR, סטטוס אימות) או של שרשרת ציבורית חיצונית חיה (גובה
// בלוק ZERO 9369, בקריאה חסרת-מפתחות ב-$0) — לא הצבעה ולא
// דעה. ההון: "נקודות אמת" (מוניטין מוצהר; אפס כסף אמיתי —
// דוקטרינת האפס של הרשת נשמרת במלואה).
//
// מכניקת הספר — זהה ברוחה לספר האימותים:
//   · כל אירוע (OPEN/STAKE/SETTLE/REFUND) הוא רשומה קנונית
//     hash-chained: entryHash = keccak256(קנון), prevHash משרשר.
//   · STAKE נחתם במפתח הסוכן שמהמר (EIP-191 + ecrecover) —
//     "שום הימור בלי חתימה", בדיוק כמו "שום טענה בלי מדידה".
//   · OPEN/SETTLE/REFUND נחתמים במפתח הרשת (אותו מפתח שחותם
//     checkpoints ב-EIP-712 — הרשת מנהלת את מחזור החיים).
//   · nonce לכל הימור: מונה מונוטוני פר-סוכן, נגזר מהספר —
//     הגנת replay מבנית.
//
// הסליקה רוכבת על סולם ההוכחות הקיים: אירוע MARKET חתום נכתב
// בספר הראשי ⇒ ה-checkpoint הבא מכסה אותו ⇒ העוגנים (Steem/Hive
// ב-:20, ZERO-EVM ב-:30) מעידים עליו ב-$0. השוק לא בונה תשתית
// חדשה — הוא מזקק את הקיימת.
//
// כנות מובנית:
//   · שוק שפג תוקפו ללא הכרעה ⇒ REFUND מלא (פתיחת-חזרה כנה,
//     לא "ניצחון" של אף צד).
//   · צד מנצח ריק ⇒ אין למי לשלם ⇒ REFUND לכולם (הון מוניטין
//     לא נשרף סתם).
//   · צד מפסיד ריק ⇒ המנצחים מקבלים את ההימור חזרה (אין סיר).
// ⚠ תווית אמת: ההון נקודות מוניטין ב-DB (DEVNET) — לא כסף,
//   לא שרשרת תשלומים; ההישג הוא המנגנון הדטרמיניסטי החתום.
// ─────────────────────────────────────────────────────────────────────

import { db } from "@/lib/db";
import { hashText } from "./chain";
import { recoverFromDigestEip191, signDigestEip191 } from "./evm";
import { appendAttestation } from "./ledger";
import { ensureDaemonAgent } from "./daemons";
import { ZERO_MIN_TARGET_GAP, ZERO_RAIL_ID, zeroBlockHeight } from "./zero";
import {
  MARKET_GENESIS as MARKET_GENESIS_CANON,
  canonicalMarketEvent as canonicalMarketEventCanon,
  canonicalMarketJson as canonicalMarketJsonCanon,
  marketEntryHash as marketEntryHashCanon,
  type MarketEventRecord as MarketEventRecordCanon,
} from "./market-canon";

// חוק נאמנות-קוד: הקנון חי ב-market-canon (חסר-DB, זמין ל-replay ציבורי) —
// כאן רק re-export. אותו קוד חותם בכתיבה ומאמת בחישוב-מחדש.
export const MARKET_GENESIS = MARKET_GENESIS_CANON;
export const canonicalMarketEvent = canonicalMarketEventCanon;
export const canonicalMarketJson = canonicalMarketJsonCanon;
export const marketEntryHash = marketEntryHashCanon;
export type MarketEventRecord = MarketEventRecordCanon;
export const STARTING_POINTS = 1000; // הון פתיחה מוצהר — נקודות אמת, לא כסף
export const SEQUENCE_MAX_DEPTH = 30; // הימורי-רצף: תקרת דורות (~חודש סבבים יומיים) — רצף לא נצחי, fail-closed

// ─── מטרות — מה שהרשת יכולה למדוד בעצמה, ומה ששרשרת חיצונית מודדת עבורה ──

export type MarketTarget =
  | { type: "stage-done"; code: string }
  | { type: "checkpoint-index"; index: number }
  | { type: "anchor-count"; count: number }
  | { type: "zero-anchor-count"; count: number }
  | { type: "attestation-status"; seq: number }
  | { type: "zero-block-height"; height: number };

export type MarketOutcome = "YES" | "NO";

export interface TargetMeasurement {
  resolved: boolean;
  outcome?: MarketOutcome;
  evidence: string; // המדידה המדויקת — נכנסת לראיה החתומה
}

/** תיאור אנושי של המטרה — ל-UI ולקנון */
export function targetLabel(target: MarketTarget): string {
  switch (target.type) {
    case "stage-done":
      return `שלב ${target.code} בתוכנית ייסגר (state=DONE עם אימות סוגר)`;
    case "checkpoint-index":
      return `checkpoint #${target.index} ייווצר בספר`;
    case "anchor-count":
      return `מספר אימותי ה-ANCHOR בספר יגיע ל-${target.count}`;
    case "zero-anchor-count":
      return `קו ה-ZERO יתעבה: עוגני ZERO בספר (anchorNet=${ZERO_RAIL_ID} — קו EVM ציבורי ב-$0) יגיעו ל-${target.count}`;
    case "attestation-status":
      return `אימות #${target.seq} יסומן VERIFIED (NO אם יופרך)`;
    case "zero-block-height":
      return `בלוק ה-ZERO (שרשרת EVM ציבורית 9369) יגיע לגובה ${target.height} — השופט: השרשרת החיצונית עצמה`;
  }
}

/** המדידה — השופט היחיד. לעולם לא דעה. */
export async function measureTarget(target: MarketTarget): Promise<TargetMeasurement> {
  switch (target.type) {
    case "stage-done": {
      const stage = await db.planStage.findUnique({ where: { code: target.code } });
      if (stage && stage.state === "DONE" && stage.attSeq != null) {
        return {
          resolved: true,
          outcome: "YES",
          evidence: `planStage ${target.code} state=DONE attSeq=${stage.attSeq} (נמדד מה-DB)`,
        };
      }
      return { resolved: false, evidence: `planStage ${target.code} state=${stage?.state ?? "NOT-FOUND"} — עדיין לא נסגר` };
    }
    case "checkpoint-index": {
      const cp = await db.checkpoint.findUnique({ where: { index: target.index } });
      if (cp) {
        return {
          resolved: true,
          outcome: "YES",
          evidence: `checkpoint #${cp.index} exists root=${cp.root.slice(0, 18)}… createdAt=${cp.createdAt.toISOString()} (נמדד מה-DB)`,
        };
      }
      return { resolved: false, evidence: `checkpoint #${target.index} עדיין לא קיים` };
    }
    case "anchor-count": {
      const count = await db.attestation.count({ where: { claimType: "ANCHOR" } });
      if (count >= target.count) {
        return { resolved: true, outcome: "YES", evidence: `ANCHOR attestations=${count} ≥ ${target.count} (נמדד מה-DB)` };
      }
      return { resolved: false, evidence: `ANCHOR attestations=${count} < ${target.count}` };
    }
    case "zero-anchor-count": {
      // עוגן ZERO = checkpoint שסומן ANCHORED על קו ה-ZERO (anchorNet נכתב
      // רק ע"י ריצת העוגן של ZERO, לאחר קבלה מהשרשרת עצמה). מדידה מבנית
      // מה-DB — ניתנת לספירה-חוזרת ע"י כל צומת מהספר המיוצא (ledger.json).
      const count = await db.checkpoint.count({ where: { anchorNet: ZERO_RAIL_ID } });
      if (count >= target.count) {
        return {
          resolved: true,
          outcome: "YES",
          evidence: `ZERO anchors (anchorNet=${ZERO_RAIL_ID})=${count} ≥ ${target.count} (נמדד מה-DB)`,
        };
      }
      return {
        resolved: false,
        evidence: `ZERO anchors (anchorNet=${ZERO_RAIL_ID})=${count} < ${target.count} — עוד ${target.count - count} ריצות עוגן (הקו מעיד כל שעה)`,
      };
    }
    case "attestation-status": {
      const att = await db.attestation.findUnique({ where: { seq: target.seq } });
      if (att?.status === "VERIFIED") {
        return { resolved: true, outcome: "YES", evidence: `attestation #${target.seq} status=VERIFIED (נמדד מה-DB)` };
      }
      if (att?.status === "REFUTED") {
        return { resolved: true, outcome: "NO", evidence: `attestation #${target.seq} status=REFUTED (נמדד מה-DB)` };
      }
      return { resolved: false, evidence: `attestation #${target.seq} status=${att?.status ?? "NOT-FOUND"} — עדיין לא הוכרע` };
    }
    case "zero-block-height": {
      // השופט החיצוני — השרשרת הציבורית עצמה, בקריאה חסרת-מפתחות.
      // גובה בלוק מונוטוני: ההכרעה האפשרית היחידה היא YES (הושג);
      // אם לא הושג בפג התוקף — REFUND כנה. כשל RPC ⇒ לא מוכרע
      // (fail-closed: אין המצאת תוצאה בלי מדידה).
      try {
        const j = await zeroBlockHeight();
        if (j.height >= target.height) {
          return {
            resolved: true,
            outcome: "YES",
            evidence: `ZERO chainId=${j.chainId} blockNumber=${j.height} ≥ ${target.height} (נמדד חי מה-RPC הציבורי ${j.endpoint} ב-${j.measuredAt})`,
          };
        }
        return {
          resolved: false,
          evidence: `ZERO chainId=${j.chainId} blockNumber=${j.height} < ${target.height} — עוד ${target.height - j.height} בלוקים (נמדד חי ב-${j.measuredAt})`,
        };
      } catch (e) {
        return {
          resolved: false,
          evidence: `ZERO RPC unreachable (${e instanceof Error ? e.message : "rpc error"}) — לא מוכרע בלי מדידה (fail-closed)`,
        };
      }
    }
  }
}

/** ולידציית מטרה בפתיחה — fail-closed, ללא מטרות דמיוניות.
 *  כל דחייה נזרקת כ-MarketError(400) — הסיבה המדויקת מגיעה ללקוח,
 *  לא מוסתרת מאחורי 500 כללי (הלקוח לומד למה נדחה, הרשת לא מסתירה). */
export async function validateTarget(target: unknown): Promise<MarketTarget> {
  if (typeof target !== "object" || target === null) {
    throw new MarketError("מטרה חסרה — שוק חייב מטרה מדידה");
  }
  const t = target as Record<string, unknown>;
  switch (t.type) {
    case "stage-done": {
      const code = String(t.code ?? "").trim().toUpperCase();
      const stage = await db.planStage.findUnique({ where: { code } });
      if (!stage) throw new MarketError(`שלב ${code || "?"} לא קיים בתוכנית — אין שוק על דבר שאינו ניתן למדידה`);
      if (stage.state === "DONE") throw new MarketError(`שלב ${code} כבר נסגר (attSeq=${stage.attSeq}) — שוק על עבר אינו שוק`);
      return { type: "stage-done", code };
    }
    case "checkpoint-index": {
      const index = Number(t.index);
      if (!Number.isInteger(index) || index <= 0) throw new MarketError("אינדקס checkpoint חייב להיות מספר טבעי");
      const max = await db.checkpoint.findFirst({ orderBy: { index: "desc" } });
      if (max && index <= max.index) throw new MarketError(`checkpoint #${index} כבר קיים (מקסימום ${max.index}) — שוק על עבר אינו שוק`);
      return { type: "checkpoint-index", index };
    }
    case "anchor-count": {
      const count = Number(t.count);
      if (!Number.isInteger(count) || count <= 0) throw new MarketError("כמות ANCHOR חייבת להיות מספר טבעי");
      const current = await db.attestation.count({ where: { claimType: "ANCHOR" } });
      if (count <= current) throw new MarketError(`כבר יש ${current} אימותי ANCHOR — שוק על עבר אינו שוק`);
      return { type: "anchor-count", count };
    }
    case "zero-anchor-count": {
      const count = Number(t.count);
      if (!Number.isInteger(count) || count <= 0) throw new MarketError("כמות עוגני ZERO חייבת להיות מספר טבעי");
      const current = await db.checkpoint.count({ where: { anchorNet: ZERO_RAIL_ID } });
      if (count <= current) {
        throw new MarketError(`כבר יש ${current} עוגני ZERO בספר — שוק על עבר אינו שוק`);
      }
      return { type: "zero-anchor-count", count };
    }
    case "attestation-status": {
      const seq = Number(t.seq);
      if (!Number.isInteger(seq)) throw new MarketError("seq אימות חייב להיות מספר שלם");
      const att = await db.attestation.findUnique({ where: { seq } });
      if (!att) throw new MarketError(`אימות #${seq} לא קיים בספר`);
      if (att.status === "VERIFIED" || att.status === "REFUTED") {
        throw new MarketError(`אימות #${seq} כבר ${att.status} — שוק על עבר אינו שוק`);
      }
      return { type: "attestation-status", seq };
    }
    case "zero-block-height": {
      const height = Number(t.height);
      if (!Number.isInteger(height) || height <= 0) {
        throw new MarketError("גובה בלוק חייב להיות מספר טבעי");
      }
      // השופט החיצוני חייב לענות בפתיחה — אין שוק על מטרה שאין לנו
      // מדידה חיה עבורה (fail-closed כפול: שרשרת + כיוון).
      let live: Awaited<ReturnType<typeof zeroBlockHeight>>;
      try {
        live = await zeroBlockHeight();
      } catch (e) {
        throw new MarketError(
          `השופט החיצוני (ZERO 9369) לא עונה: ${e instanceof Error ? e.message : "rpc error"} — אין פתיחת שוק בלי מדידה חיה`,
          503
        );
      }
      if (height <= live.height) {
        throw new MarketError(`בלוק ה-ZERO כבר בגובה ${live.height} — שוק על עבר אינו שוק`);
      }
      if (height - live.height < ZERO_MIN_TARGET_GAP) {
        throw new MarketError(
          `פער ${height - live.height} בלוקים קטן מהמינימום (${ZERO_MIN_TARGET_GAP} ≈ 5 דקות) — הטענה חייבת להיות עתידית-ממשית`
        );
      }
      return { type: "zero-block-height", height };
    }
    default:
      throw new MarketError(`סוג מטרה לא נתמך (${String(t.type ?? "?")})`);
  }
}

// ─── ספר האירועים — קנון ושרשרת (ההגדרות ב-market-canon.ts; כאן re-export בלבד) ──

/** הפעלות על ה-payload — סדר שדות קבוע לכל סוג אירוע */
export interface OpenPayload {
  kind: "OPEN";
  title: string;
  target: MarketTarget;
  byDate: string; // ISO — פג תוקף; לאחריו REFUND אם לא הוכרע
  createdBy: string; // agentId של פותח השוק
  /** הימור-רצף: בסליקה מדודה הרגולטור פותח אוטומטית את הדור הבא — הרשת ממשיכה לשאול */
  sequence?: { depth: number };
  /** השוק שילד אותי — מניעת כפילויות ושרשרת אבות ניתנת לשחזור */
  successorOf?: number;
}

export interface StakePayload {
  kind: "STAKE";
  marketSeq: number; // seq של אירוע ה-OPEN
  agentId: string;
  agentAddress: string;
  side: MarketOutcome; // YES = הטענה תאומת · NO = תופרך
  points: number;
  nonce: number; // מונה פר-סוכן — replay protection
}

export interface SettlePayload {
  kind: "SETTLE";
  marketSeq: number;
  outcome: MarketOutcome;
  resolution: string; // המדידה עצמה — מה-DB, לא מהלקוח
  winners: Array<{ agentId: string; points: number; payout: number }>;
  losers: Array<{ agentId: string; points: number; lost: number }>;
  potYes: number;
  potNo: number;
}

export interface RefundPayload {
  kind: "REFUND";
  marketSeq: number;
  reason: string; // "expired-unresolved" | "no-winners"
  refunds: Array<{ agentId: string; points: number }>;
}

export type MarketPayload = OpenPayload | StakePayload | SettlePayload | RefundPayload;

export function canonicalPayloadJson(payload: MarketPayload): string {
  return JSON.stringify(payload); // סדר שדות קבוע בהגדרת ה-interface — דטרמיניסטי
}

// ─── שרשרת משמרת על החתימות ──

export class MarketError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "MarketError";
    this.status = status;
  }
}

async function networkKey(): Promise<{ address: string; devKeyHex: string }> {
  const nk = await db.networkKey.findUnique({ where: { id: "weave-network" } });
  if (!nk?.devKeyHex) {
    throw new MarketError("מפתח הרשת אינו זמין — השוק נעול (fail-closed)", 503);
  }
  return { address: nk.address, devKeyHex: nk.devKeyHex };
}

async function appendEvent(payload: MarketPayload, signer: "network" | { agentId: string }): Promise<{ seq: number; entryHash: string }> {
  // 1. החותם הצפוי — מפתח הרשת לאירועי מחזור-חיים, הסוכן להימור
  let signerKeyHex: string;
  let expectedAddr: string;
  if (signer === "network") {
    const nk = await networkKey();
    signerKeyHex = nk.devKeyHex;
    expectedAddr = nk.address;
  } else {
    const agent = await db.agent.findUnique({ where: { id: signer.agentId } });
    if (!agent || agent.status !== "ACTIVE" || !agent.devKeyHex) {
      throw new MarketError("הסוכן אינו פעיל או חסר מפתח — אין חתימה", 400);
    }
    signerKeyHex = agent.devKeyHex;
    expectedAddr = agent.ethAddress;
  }

  // 2. השרשרת
  const last = await db.marketEvent.findFirst({ orderBy: { seq: "desc" } });
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.entryHash ?? MARKET_GENESIS;
  const createdAt = new Date();
  const payloadJson = canonicalPayloadJson(payload);
  const payloadHash = hashText(payloadJson);
  const rec = canonicalMarketEvent({ seq, kind: payload.kind, payloadHash, prevHash, createdAt });
  const entryHash = marketEntryHash(rec);

  // 3. חתימת EIP-191 על digest ה-payload + שחזור ecrecover — בזמן הכתיבה
  const sig = await signDigestEip191(signerKeyHex, payloadHash);
  const recovered = recoverFromDigestEip191(payloadHash, sig);
  if (recovered.toLowerCase() !== expectedAddr.toLowerCase()) {
    throw new MarketError(
      `אימות חתימה נכשל: recovered ${recovered} ≠ expected ${expectedAddr} — האירוע לא נכתב (fail-closed)`,
      500
    );
  }

  await db.marketEvent.create({
    data: {
      seq,
      kind: payload.kind,
      payload: payloadJson,
      payloadHash,
      prevHash,
      entryHash,
      sig,
      signerAddr: recovered,
      createdAt,
    },
  });
  return { seq, entryHash };
}

// ─── חישוב הספר — replay דטרמיניסטי מהאירועים ──

export interface StakeView {
  seq: number;
  agentId: string;
  agentName: string;
  agentAddress: string;
  side: MarketOutcome;
  points: number;
  nonce: number;
  at: string;
}

export interface ListingView {
  marketSeq: number;
  title: string;
  target: MarketTarget;
  targetLabel: string;
  byDate: string;
  createdBy: string;
  createdAt: string;
  status: "OPEN" | "SETTLED" | "REFUNDED";
  sequence?: { depth: number };
  successorOf?: number;
  stakes: StakeView[];
  potYes: number;
  potNo: number;
  totalPot: number;
  stakerCount: number;
  outcome?: MarketOutcome;
  resolution?: string;
  winners?: Array<{ agentId: string; agentName: string; points: number; payout: number }>;
  losers?: Array<{ agentId: string; agentName: string; points: number; lost: number }>;
  settledAt?: string;
  settleAttSeq?: number;
  refundReason?: string;
}

export interface AgentCapitalView {
  agentId: string;
  agentName: string;
  agentAddress: string;
  starting: number;
  staked: number; // מושקע בשווקים פתוחים (נעול)
  winnings: number; // סה"כ תשלומים מסליקות
  losses: number; // סה"כ הפסדים מסליקות
  available: number; // starting + winnings - losses - staked
}

export interface BookView {
  events: number;
  headHash: string;
  chainValid: boolean;
  firstBreak: number | null;
  sigOk: number;
  listings: ListingView[];
  agents: AgentCapitalView[];
}

interface ReplayState {
  listings: Map<number, ListingView>;
  agents: Map<string, { staked: number; winnings: number; losses: number }>;
}

/** replay מלא של הספר — מהאירועים בלבד, כל צומת יכול לחשב מחדש */
export async function computeBook(): Promise<BookView> {
  const events = await db.marketEvent.findMany({ orderBy: { seq: "asc" } });
  const agentRows = await db.agent.findMany();
  const agentById = new Map(agentRows.map((a) => [a.id, a]));

  const state: ReplayState = { listings: new Map(), agents: new Map() };
  const capFor = (agentId: string) => {
    let c = state.agents.get(agentId);
    if (!c) {
      c = { staked: 0, winnings: 0, losses: 0 };
      state.agents.set(agentId, c);
    }
    return c;
  };

  let prevHash = MARKET_GENESIS;
  let chainValid = true;
  let firstBreak: number | null = null;
  let sigOk = 0;
  const nk = await db.networkKey.findUnique({ where: { id: "weave-network" } });

  for (const ev of events) {
    // שרשרת: חישוב מחדש
    const rec = canonicalMarketEvent({
      seq: ev.seq,
      kind: ev.kind,
      payloadHash: ev.payloadHash,
      prevHash: ev.prevHash,
      createdAt: ev.createdAt,
    });
    const recomputed = marketEntryHash(rec);
    if (recomputed !== ev.entryHash || ev.prevHash !== prevHash) {
      chainValid = false;
      firstBreak = firstBreak ?? ev.seq;
    }
    // חתימה: ecrecover מחדש — החותם הצפוי לפי סוג האירוע:
    // STAKE ⇒ הסוכן שמהמר · OPEN ⇒ הסוכן שפתח · SETTLE/REFUND ⇒ מפתח הרשת
    try {
      const recovered = recoverFromDigestEip191(ev.payloadHash, ev.sig ?? "");
      const payloadPeek = JSON.parse(ev.payload) as Partial<MarketPayload>;
      const expected =
        ev.kind === "STAKE"
          ? agentById.get((payloadPeek as StakePayload).agentId)?.ethAddress
          : ev.kind === "OPEN"
            ? agentById.get((payloadPeek as OpenPayload).createdBy)?.ethAddress
            : nk?.address;
      if (expected && recovered.toLowerCase() === expected.toLowerCase()) sigOk++;
    } catch {
      // חתימה שבורה — לא נספרת; השרשרת עדיין נבדקת למעלה
    }
    prevHash = ev.entryHash;

    // replay העסקה
    const payload = JSON.parse(ev.payload) as MarketPayload;
    if (payload.kind === "OPEN") {
      state.listings.set(ev.seq, {
        marketSeq: ev.seq,
        title: payload.title,
        target: payload.target,
        targetLabel: targetLabel(payload.target),
        byDate: payload.byDate,
        createdBy: payload.createdBy,
        createdAt: ev.createdAt.toISOString(),
        status: "OPEN",
        sequence: payload.sequence,
        successorOf: payload.successorOf,
        stakes: [],
        potYes: 0,
        potNo: 0,
        totalPot: 0,
        stakerCount: 0,
      });
    } else if (payload.kind === "STAKE") {
      const listing = state.listings.get(payload.marketSeq);
      const agent = agentById.get(payload.agentId);
      if (listing && listing.status === "OPEN" && agent) {
        listing.stakes.push({
          seq: ev.seq,
          agentId: payload.agentId,
          agentName: agent.name,
          agentAddress: payload.agentAddress,
          side: payload.side,
          points: payload.points,
          nonce: payload.nonce,
          at: ev.createdAt.toISOString(),
        });
        if (payload.side === "YES") listing.potYes += payload.points;
        else listing.potNo += payload.points;
        listing.totalPot = listing.potYes + listing.potNo;
        listing.stakerCount = new Set(listing.stakes.map((s) => s.agentId)).size;
        capFor(payload.agentId).staked += payload.points;
      }
    } else if (payload.kind === "SETTLE") {
      const listing = state.listings.get(payload.marketSeq);
      if (listing && listing.status === "OPEN") {
        listing.status = "SETTLED";
        listing.outcome = payload.outcome;
        listing.resolution = payload.resolution;
        listing.winners = payload.winners.map((w) => ({
          ...w,
          agentName: agentById.get(w.agentId)?.name ?? "?",
        }));
        listing.losers = payload.losers.map((l) => ({
          ...l,
          agentName: agentById.get(l.agentId)?.name ?? "?",
        }));
        listing.settledAt = ev.createdAt.toISOString();
        listing.settleAttSeq = undefined; // יושלם בהמשך replay (האימות נכתב אחרי)
        // הון: משחרר נעילה, מזרים תשלומים והפסדים
        for (const s of listing.stakes) {
          const cap = capFor(s.agentId);
          cap.staked -= s.points;
          if (s.side === payload.outcome) cap.winnings += payoutFor(s, payload);
          else cap.losses += s.points;
        }
      }
    } else if (payload.kind === "REFUND") {
      const listing = state.listings.get(payload.marketSeq);
      if (listing && listing.status === "OPEN") {
        listing.status = "REFUNDED";
        listing.refundReason = payload.reason;
        listing.settledAt = ev.createdAt.toISOString();
        for (const s of listing.stakes) {
          capFor(s.agentId).staked -= s.points;
          capFor(s.agentId).winnings += s.points; // החזר — נכנס כ"תשלום" כדי לאפס הון
        }
      }
    }
  }

  const listings = [...state.listings.values()].sort((a, b) => b.marketSeq - a.marketSeq);
  const agents: AgentCapitalView[] = agentRows
    .filter((a) => a.status === "ACTIVE")
    .map((a) => {
      const c = state.agents.get(a.id) ?? { staked: 0, winnings: 0, losses: 0 };
      return {
        agentId: a.id,
        agentName: a.name,
        agentAddress: a.ethAddress,
        starting: STARTING_POINTS,
        staked: c.staked,
        winnings: c.winnings,
        losses: c.losses,
        available: STARTING_POINTS + c.winnings - c.losses - c.staked,
      };
    })
    .sort((x, y) => y.available + y.winnings - (x.available + x.winnings));

  return {
    events: events.length,
    headHash: prevHash,
    chainValid,
    firstBreak,
    sigOk,
    listings,
    agents,
  };
}

/** חישוב תשלום פר-מהמר מתוך המטען — פרו-רטה להימור המנצח */
function payoutFor(s: StakeView, p: SettlePayload): number {
  const w = p.winners.find((x) => x.agentId === s.agentId);
  return w ? w.payout : 0;
}

// ─── פעולות השוק ──

export async function openMarket(input: {
  title: string;
  target: unknown;
  byDate: string;
  createdBy: string;
  sequence?: boolean;
  successorOf?: number;
}): Promise<{ marketSeq: number; entryHash: string }> {
  const title = input.title.trim();
  if (title.length < 8 || title.length > 160) {
    throw new MarketError("כותרת השוק חייבת 8-160 תווים — שוק על טענה מנוסחת");
  }
  const byMs = Date.parse(input.byDate);
  if (!Number.isFinite(byMs)) throw new MarketError("תאריך תפוגה לא תקין");
  const byDate = new Date(byMs).toISOString();
  if (byMs <= Date.now()) throw new MarketError("תאריך התפוגה בעבר — שוק חייב עתיד ניתן למדידה");
  if (byMs > Date.now() + 1000 * 60 * 60 * 24 * 90) {
    throw new MarketError("אופק מקסימלי 90 יום — שוק מדידה, לא נבואה");
  }
  const agent = await db.agent.findUnique({ where: { id: input.createdBy } });
  if (!agent || agent.status !== "ACTIVE") throw new MarketError("פותח השוק חייב סוכן פעיל");

  const target = await validateTarget(input.target);

  // הימור-רצף — opt-in מפורש: הרשת מתחייבת להמשיך לשאול אחרי סליקה מדודה.
  // תקרת עומק fail-closed — רצף הוא מנגנון, לא נצח; וסדר האבות נבדק כנגד הספר.
  let sequence: { depth: number } | undefined;
  if (input.sequence) {
    if (target.type !== "zero-anchor-count") {
      throw new MarketError("הימור-רצף (v1) תומך רק במטרות zero-anchor-count — קו העדות האוטונומי שמעיד כל שעה");
    }
    if (input.successorOf == null) {
      sequence = { depth: 1 }; // דור הייסוד — נפתח ע"י יד מפורשת (אדם/API)
    } else {
      const parent = await db.marketEvent.findUnique({ where: { seq: input.successorOf } });
      if (!parent || parent.kind !== "OPEN") {
        throw new MarketError(`אב הרצף #${input.successorOf} לא נמצא בספר — אין יחוס מזויף`);
      }
      const parentPayload = JSON.parse(parent.payload) as OpenPayload;
      if (!parentPayload.sequence) {
        throw new MarketError(`אב #${input.successorOf} אינו שוק-רצף — הרצף לא נצמד אחרי העובדה`);
      }
      if (parentPayload.sequence.depth >= SEQUENCE_MAX_DEPTH) {
        throw new MarketError(`תקרת רצף (${SEQUENCE_MAX_DEPTH} דורות) הושגה — הרשת יודעת להפסיק`);
      }
      sequence = { depth: parentPayload.sequence.depth + 1 };
    }
  }

  // appendEvent מחזיר { seq, entryHash } — החוזה הציבורי של openMarket הוא marketSeq
  // (כך קוראים: /api/weave/market/open ופתיחת דור-ההמשך בשוק-רצף). מיפוי שדה בלבד.
  const opened = await appendEvent(
    {
      kind: "OPEN",
      title,
      target,
      byDate,
      createdBy: input.createdBy,
      ...(sequence ? { sequence } : {}),
      ...(input.successorOf != null ? { successorOf: input.successorOf } : {}),
    },
    { agentId: input.createdBy } // הפותח חותם על פתיחת השוק שלו
  );
  return { marketSeq: opened.seq, entryHash: opened.entryHash };
}

export async function placeStake(input: {
  marketSeq: number;
  agentId: string;
  side: MarketOutcome;
  points: number;
}): Promise<{ seq: number; entryHash: string }> {
  const points = Number(input.points);
  if (!Number.isInteger(points) || points <= 0 || points > 10_000) {
    throw new MarketError("הימור חייב 1-10,000 נקודות (שלמות)");
  }
  if (input.side !== "YES" && input.side !== "NO") throw new MarketError("צד הימור חייב YES או NO");

  const book = await computeBook();
  const listing = book.listings.find((l) => l.marketSeq === input.marketSeq);
  if (!listing) throw new MarketError(`שוק #${input.marketSeq} לא קיים בספר`, 404);
  if (listing.status !== "OPEN") throw new MarketError(`שוק #${input.marketSeq} כבר ${listing.status === "SETTLED" ? "סולק" : "הוחזר"} — אין הימורים`);

  const agent = await db.agent.findUnique({ where: { id: input.agentId } });
  if (!agent || agent.status !== "ACTIVE" || !agent.devKeyHex) {
    throw new MarketError("הסוכן אינו פעיל או חסר מפתח — אין חתימה");
  }

  // הון: ההימור חייב להיות מכוסה — replay הוא השופט
  const cap = book.agents.find((a) => a.agentId === input.agentId);
  if (!cap || cap.available < points) {
    throw new MarketError(
      `הון לא מספיק: זמין ${cap?.available ?? 0} < ${points} נקודות — השוק לא מלווה (honest)`
    );
  }

  // nonce: מונה פר-סוכן נגזר מהספר — replay protection
  const priorStakes = await db.marketEvent.findMany({ where: { kind: "STAKE" } });
  const nonce =
    priorStakes.filter((e) => (JSON.parse(e.payload) as StakePayload).agentId === input.agentId).length + 1;

  return appendEvent(
    {
      kind: "STAKE",
      marketSeq: input.marketSeq,
      agentId: input.agentId,
      agentAddress: agent.ethAddress,
      side: input.side,
      points,
      nonce,
    },
    { agentId: input.agentId } // המהמר חותם על ההימור שלו
  );
}

// ─── המכריע — המדידה קובעת, הרשת חותמת, הספר מעיד ──

export interface SettlementResult {
  settled: Array<{ marketSeq: number; outcome: MarketOutcome; attSeq: number; winners: number; pot: number }>;
  refunded: Array<{ marketSeq: number; reason: string; refunds: number }>;
  /** הימורי-רצף: הדור הבא שנפתח אוטומטית בסליקה מדודה — או הסיבה הכנה שלא נפתח */
  successors: Array<{ marketSeq: number; successorSeq?: number; depth?: number; reason?: string }>;
  attSeqs: number[];
}

/**
 * הרצת המכריע: לכל שוק פתוח — מדידה חיה של המטרה; הוכרע ⇒ SETTLE,
 * פג תוקף ⇒ REFUND. כל סליקה נכתבת כאימות MARKET חתום בספר הראשי
 * (הראיה = המדידה עצמה), ואחריה checkpoint מיידי — סולם ההוכחות
 * הקיים מרים את השוק על כתפיו.
 */
export async function resolveOpenMarkets(): Promise<SettlementResult> {
  const book = await computeBook();
  const open = book.listings.filter((l) => l.status === "OPEN");
  const result: SettlementResult = { settled: [], refunded: [], successors: [], attSeqs: [] };

  for (const listing of open) {
    const m = await measureTarget(listing.target);
    const expired = Date.parse(listing.byDate) <= Date.now();
    // כנות הטענה: בית המשפט נקרא בשמו — הרשת עצמה או השרשרת החיצונית
    const judgeNote =
      listing.target.type === "zero-block-height"
        ? "השופט: שרשרת ציבורית חיצונית חיה (ZERO 9369, קריאה חסרת-מפתחות), לא הצבעה"
        : "השופט: המדידה של הרשת עצמה, לא הצבעה";

    if (m.resolved && (m.outcome === "YES" || m.outcome === "NO")) {
      // מתמטיקת הסליקה — פרו-רטה לצד המנצח; מקרי-קצה כנים
      const winnersStakes = listing.stakes.filter((s) => s.side === m.outcome);
      const losersStakes = listing.stakes.filter((s) => s.side !== m.outcome);
      const potWin = m.outcome === "YES" ? listing.potYes : listing.potNo;
      const potLose = m.outcome === "YES" ? listing.potNo : listing.potYes;

      if (winnersStakes.length === 0) {
        // אין זוכים — פתיחת-חזרה כנה, ההון לא נשרף סתם
        const refunds = losersStakes.map((s) => ({ agentId: s.agentId, points: s.points }));
        await appendEvent(
          {
            kind: "REFUND",
            marketSeq: listing.marketSeq,
            reason: `no-winners (outcome=${m.outcome}, winning side empty)`,
            refunds,
          },
          "network"
        );
        const att = await writeMarketAttestation(
          `שוק האמת #${listing.marketSeq} "${listing.title}" — הוכרע ${m.outcome === "YES" ? "לחיוב" : "לשלילה"} אך אף סוכן לא הימר על הצד המנצח: ההימורים הוחזרו במלואם (פתיחת-חזרה כנה, לא ניצחון).`,
          `marketSeq=${listing.marketSeq} · disposition=REFUND/no-winners · outcome=${m.outcome} · resolution=${m.evidence} · stakesRefunded=${refunds.length} · points=${refunds.reduce((a, r) => a + r.points, 0)}`
        );
        result.refunded.push({ marketSeq: listing.marketSeq, reason: "no-winners", refunds: refunds.length });
        result.attSeqs.push(att.seq);
        continue;
      }

      // הפסדים מחולקים למנצחים פרו-רטה להימור; ההימור עצמו חוזר
      const winners = winnersStakes.map((s) => ({
        agentId: s.agentId,
        points: s.points,
        payout: potLose > 0 ? s.points + Math.floor((potLose * s.points) / potWin) : s.points,
      }));
      const losers = losersStakes.map((s) => ({ agentId: s.agentId, points: s.points, lost: s.points }));

      await appendEvent(
        {
          kind: "SETTLE",
          marketSeq: listing.marketSeq,
          outcome: m.outcome,
          resolution: m.evidence,
          winners,
          losers,
          potYes: listing.potYes,
          potNo: listing.potNo,
        },
        "network"
      );

      const totalPaid = winners.reduce((a, w) => a + w.payout, 0);
      const att = await writeMarketAttestation(
        `שוק האמת #${listing.marketSeq} "${listing.title}" — הוכרע ${m.outcome === "YES" ? "לחיוב (הטענה נמדאה)" : "לשלילה (הטענה הופרכה)"}: ${winners.length} מנצחים חילקו ${totalPaid} נקודות אמת; ${losers.length} מפסידים איבדו ${potLose}. ${judgeNote}.`,
        `marketSeq=${listing.marketSeq} · disposition=SETTLED · outcome=${m.outcome} · resolution=${m.evidence} · winners=${winners.map((w) => `${w.agentId.slice(0, 8)}:${w.payout}`).join(",")} · losers=${losers.length} · potYes=${listing.potYes} potNo=${listing.potNo} · totalPaid=${totalPaid}`
      );
      result.settled.push({
        marketSeq: listing.marketSeq,
        outcome: m.outcome,
        attSeq: att.seq,
        winners: winners.length,
        pot: totalPaid,
      });
      result.attSeqs.push(att.seq);

      // ── הימור-רצף: סליקה מדודה התרחשה — הרשת ממשיכה לשאול את השאלה הבאה ──
      // הרגולטור פותח את הדור הבא (חותם OPEN משלו); הסוכנים בוחרים צדדים
      // בעצמם — הפרדת תפקידים: הפותח/המכריע (הרגולטור) לא מהמר ולא נהנה.
      if (listing.sequence) {
        try {
          if (listing.sequence.depth >= SEQUENCE_MAX_DEPTH) {
            result.successors.push({
              marketSeq: listing.marketSeq,
              reason: `תקרת רצף (${SEQUENCE_MAX_DEPTH}) הושגה — הרשת יודעת להפסיק (fail-closed)`,
            });
          } else if (book.listings.some((l) => l.successorOf === listing.marketSeq)) {
            result.successors.push({ marketSeq: listing.marketSeq, reason: "הדור הבא כבר קיים בספר — אין כפילויות" });
          } else {
            // המציאות כרגע + 2 חלונות עוגן (הקו מעיד כל שעה) — אותה נקודת
            // מבט של m#26: עתיד ניתן למדידה, לא נבואה. תוקף: 24 שעות (4 חלונות).
            const zeroAnchors = await db.checkpoint.count({ where: { anchorNet: ZERO_RAIL_ID } });
            const nextCount = zeroAnchors + 2;
            const byDate = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();
            const regulator = await ensureMarketRegulator();
            const { marketSeq: successorSeq } = await openMarket({
              title: `קו ה-ZERO יתעבה: עוגני ZERO בספר יגיעו ל-${nextCount} · רצף דור ${listing.sequence.depth + 1}`,
              target: { type: "zero-anchor-count", count: nextCount },
              byDate,
              createdBy: regulator.id,
              sequence: true,
              successorOf: listing.marketSeq,
            });
            result.successors.push({
              marketSeq: listing.marketSeq,
              successorSeq,
              depth: listing.sequence.depth + 1,
            });
          }
        } catch (e) {
          // כישלון יצירת הדור הבא לעולם לא מפיל את הסליקה — נרשם בכנות
          result.successors.push({
            marketSeq: listing.marketSeq,
            reason: `פתיחת הדור הבא נכשלה בכנות: ${e instanceof Error ? e.message : "שגיאה לא ידועה"}`,
          });
        }
      }
    } else if (expired) {
      // פג תוקף ללא הכרעה — החזר מלא (כנות: לא "ניצחון" של אף צד)
      const refunds = listing.stakes.map((s) => ({ agentId: s.agentId, points: s.points }));
      await appendEvent(
        {
          kind: "REFUND",
          marketSeq: listing.marketSeq,
          reason: "expired-unresolved",
          refunds,
        },
        "network"
      );
      const att = await writeMarketAttestation(
        `שוק האמת #${listing.marketSeq} "${listing.title}" — פג תוקף בלי הכרעה מדודה: כל ההימורים הוחזרו במלואם (${refunds.length} סוכנים, ${refunds.reduce((a, r) => a + r.points, 0)} נקודות). השוק לא ממציא תוצאה.`,
        `marketSeq=${listing.marketSeq} · disposition=REFUND/expired · byDate=${listing.byDate} · refunds=${refunds.length} · points=${refunds.reduce((a, r) => a + r.points, 0)}`
      );
      result.refunded.push({ marketSeq: listing.marketSeq, reason: "expired-unresolved", refunds: refunds.length });
      result.attSeqs.push(att.seq);
    }
  }

  return result;
}

/** אימות MARKET חתום בספר הראשי — בחתימת זהות הרגולטור (fail-closed) */
async function writeMarketAttestation(claim: string, evidence: string): Promise<{ seq: number }> {
  const regulator = await ensureMarketRegulator();
  const att = await appendAttestation({
    agentId: regulator.id,
    claim,
    claimType: "MARKET",
    evidence,
  });
  return { seq: att.seq };
}

/** זהות רגולטור השוק — DAEMON נגזר ממפתח הרשת שב-seal (Task 17):
 *  הגזירה הדטרמיניסטית מבטיחה שהענן (שמייבא את הספר בלי מפתחות) משלים
 *  את אותו מפתח בדיוק מה-seal ויכול לחתום — self-heal כמו מפתח הרשת.
 *  הזהות הישנה (אקראית, מקומית בלבד) פרשה במיגרציה מתועדת —
 *  scripts/weave-daemon-migrate.ts — ואימותיה נשארים חתומים עליה. */
export async function ensureMarketRegulator(): Promise<{ id: string; name: string; ethAddress: string }> {
  return ensureDaemonAgent("weave-market-regulator", "DAEMON");
}
