// ─────────────────────────────────────────────────────────────────────
// PNL-LEDGER · פנקס-הרווח-וההפסד האמיתי (r144-c · D-SCALE evidence step)
//
// הוראת המפעיל (2026-10-01): "המערך הכלכלי מדומה — התחילו להריץ אותו
// והפכו אותו לערך-אמיתי צעד-צעד... הרבה יותר טרנזקציות, הרבה דרכים
// חכמות להזרים נזילות. עשו את השוק כולו אמיתי, צעד-צעד. בצעו."
//
// הפער שהפנקס סוגר (נמדד בפתיחת r144-c): הסולם חי על השרשרת
// (756.909 STEEM בפקודות פתוחות · 6 פקודות), המילויים נסרקים מהשרשרת
// (fill_order, checkpoint pnl-scan.json) — אבל אין מסמך-אמת אחד שעונה
// "כמה נתפס בפועל (realized) וכמה יושב פתוח (unrealized)" עם ראיה
// לכל מספר. הפנקס הזה הוא המסמך: append-only, hash-chained כמו
// יומן-ההחלטות (prevHash → entryHash, sha256).
//
// מקורות — אפס מספרים מומצאים:
//   · מילויים (realized): השרשרת עצמה — fill_order מהסריקה המצ'קפוינטת
//     sovereign/money/pnl-scan.json (מנוע grid-pnl R95, כל מילוי נושא
//     אינדקס-היסטוריית-חשבון = ראיה יציבה).
//   · פקודות ושערים (unrealized): /api/money חי (get_open_orders +
//     get_order_book + סימוני-חוץ) — כל פקודה נושאת orderid.
//   · קבלות-פעולה (txids): sovereign/money/history.json — כל פעולת
//     מוביל עם txid שרשרת לכל cancel ו-create.
//   · נתון חסר נכתב "unmeasured" — לעולם לא אפס-כאמת.
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
// r147-d · גוף-אחד: קנון-הגיבוב עבר ל-src/lib/weave/hash-chain.ts — מנגנון אחד לכל השרשרות בבית
import { hashChainEntry, verifyHashChain } from "@/lib/weave/hash-chain";

const HOME = "/home/z/my-project";
const SCAN_FILE = path.join(HOME, "sovereign/money/pnl-scan.json");
const RECEIPTS_FILE = path.join(HOME, "sovereign/money/history.json");
const SNAPSHOTS_DIR = path.join(HOME, "sovereign/economy");
const SNAPSHOTS_FILE = path.join(SNAPSHOTS_DIR, "pnl-snapshots.json");
const MONEY_API = "http://127.0.0.1:3000/api/money";

/** מרווח-מינימום בין תמונות-מצב — קצב-התרבות מדוד, לא הצפה */
const SNAPSHOT_MIN_INTERVAL_MS = 30 * 60_000;

// ── טיפוסים ──────────────────────────────────────────────────────────

export interface LedgerFill {
  idx: number;
  at: string;
  side: "bought-steem" | "sold-steem";
  price: number | null;
  steem: number;
  sbd: number;
  maker: boolean;
}

export interface LedgerTrip {
  openedAt: string;
  closedAt: string;
  steem: number;
  entryPrice: number;
  exitPrice: number;
  capturedSbd: number;
  capturedBps: number;
  /** ראיה: אינדקסי המילויים שפתחו וסגרו את הסבב (היסטוריית-החשבון על השרשרת) */
  openedByFillIdx: number;
  closedByFillIdx: number;
}

export interface LedgerLot {
  fillIdx: number;
  at: string;
  steem: number;
  price: number;
}

export interface MoneyLive {
  fetched: boolean;
  parity: number | null;
  paritySource: string | null;
  steemUsd: number | null;
  sbdUsd: number | null;
  sbdSource: string | null;
  orders: Array<{ orderid: number; amount: number; price: number; usdIfFilled: number | null }>;
  ordersTotalSteem: number | null;
  bids: Array<{ orderid: number; sbd: number; price: number }>;
  deployedSteem: number | null;
  idleSteem: number | null;
  liquidSteem: number | null;
  liquidSbd: number | null;
  valueFloorState: string | null;
  fillsWindow24h: number | null;
  note: string | null;
}

export interface ReceiptEvidence {
  total: number;
  withTxid: number;
  lastAt: string | null;
  lastKinds: string[];
  lastTxids: string[];
  source: string;
}

export interface PnlSnapshotEntry {
  seq: number;
  at: string;
  account: string;
  realized: {
    measured: boolean;
    fillsTotal: number;
    trips: number;
    capturedSbd: number;
    capturedUsd: number | null;
    netSteem: number | null;
    netSbd: number | null;
    openLongSteem: number | null;
    firstFillAt: string | null;
    lastFillAt: string | null;
    note: string;
  };
  unrealized: {
    measured: boolean;
    ordersOpen: number;
    deployedSteem: number | null;
    ladderPremiumSbd: number | null;
    ladderPremiumUsd: number | null;
    ordersBelowParity: number | null;
    openLongMarkSbd: number | null;
    openLongMarkUsd: number | null;
    bidsOpenSbd: number | null;
    note: string;
  };
  marks: {
    parity: number | null;
    paritySource: string | null;
    steemUsd: number | null;
    sbdUsd: number | null;
    sbdSource: string | null;
  };
  sources: {
    fills: string;
    ordersAndMarks: string;
    receipts: string;
    usdConversion: string;
  };
  receipts: { total: number; withTxid: number; lastAt: string | null; lastKinds: string[]; lastTxids: string[] };
  fillsLast: Array<{ idx: number; at: string; side: string; price: number | null; steem: number; sbd: number }>;
  prevHash: string;
  entryHash: string;
}

export interface SnapshotFile {
  format: "weave-pnl-snapshots-v1";
  savedAt: string;
  entries: PnlSnapshotEntry[];
}

export interface SnapshotChainState {
  entries: number;
  ok: boolean;
  brokenAt: number | null;
  lastAt: string | null;
}

// ── מילויים מהשרשרת (checkpoint של מנוע-הסריקה R95) ──────────────────

interface Checkpoint {
  savedAt?: string;
  maxIndex?: number;
  downToIndex?: number;
  floorIso?: string;
  fills?: Array<Record<string, unknown>>;
}

function loadFills(): { fills: LedgerFill[]; savedAt: string | null; maxIndex: number | null; ok: boolean } {
  try {
    const cp = JSON.parse(fs.readFileSync(SCAN_FILE, "utf8")) as Checkpoint;
    if (!Array.isArray(cp.fills)) return { fills: [], savedAt: null, maxIndex: null, ok: false };
    const fills: LedgerFill[] = [];
    for (const raw of cp.fills) {
      const idx = Number(raw.idx);
      const steem = Number(raw.steem);
      const sbd = Number(raw.sbd);
      const side = raw.side === "sold-steem" || raw.side === "bought-steem" ? raw.side : null;
      if (!Number.isFinite(idx) || !side || !Number.isFinite(steem) || !Number.isFinite(sbd)) continue;
      const price = Number(raw.price);
      fills.push({
        idx,
        at: String(raw.at ?? ""),
        side,
        price: Number.isFinite(price) && price > 0 ? price : null,
        steem,
        sbd,
        maker: Boolean(raw.maker),
      });
    }
    fills.sort((a, b) => a.idx - b.idx);
    return {
      fills,
      savedAt: typeof cp.savedAt === "string" ? cp.savedAt : null,
      maxIndex: Number.isFinite(Number(cp.maxIndex)) ? Number(cp.maxIndex) : null,
      ok: true,
    };
  } catch {
    return { fills: [], savedAt: null, maxIndex: null, ok: false };
  }
}

// ── FIFO: סבבים שנסגרו (realized) + מלאי פתוח (unrealized) ───────────

export function fifo(fills: LedgerFill[]): { trips: LedgerTrip[]; openLots: LedgerLot[] } {
  const queue: LedgerLot[] = [];
  const trips: LedgerTrip[] = [];
  for (const f of fills) {
    if (f.price == null) continue;
    if (f.side === "bought-steem") {
      queue.push({ fillIdx: f.idx, at: f.at, steem: f.steem, price: f.price });
    } else {
      let remain = f.steem;
      while (remain > 1e-9 && queue.length) {
        const head = queue[0]!;
        const take = Math.min(remain, head.steem);
        trips.push({
          openedAt: head.at,
          closedAt: f.at,
          steem: Math.round(take * 1e3) / 1e3,
          entryPrice: head.price,
          exitPrice: f.price,
          capturedSbd: Math.round((f.price - head.price) * take * 1e6) / 1e6,
          capturedBps: Math.round(((f.price - head.price) / head.price) * 10_000),
          openedByFillIdx: head.fillIdx,
          closedByFillIdx: f.idx,
        });
        head.steem -= take;
        remain -= take;
        if (head.steem <= 1e-9) queue.shift();
      }
    }
  }
  return { trips, openLots: queue };
}

// ── /api/money חי (השרשרת מאחוריו: get_open_orders/get_order_book) ───

async function fetchMoneyLive(): Promise<MoneyLive> {
  const dead: MoneyLive = {
    fetched: false,
    parity: null,
    paritySource: null,
    steemUsd: null,
    sbdUsd: null,
    sbdSource: null,
    orders: [],
    ordersTotalSteem: null,
    bids: [],
    deployedSteem: null,
    idleSteem: null,
    liquidSteem: null,
    liquidSbd: null,
    valueFloorState: null,
    fillsWindow24h: null,
    note: "unmeasured: /api/money לא נענה — unrealized לא נמדד בתמונה זו",
  };
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 12_000);
    let j: Record<string, unknown>;
    try {
      const res = await fetch(MONEY_API, { signal: ctl.signal, cache: "no-store" });
      if (!res.ok) throw new Error(`http ${res.status}`);
      j = (await res.json()) as Record<string, unknown>;
    } finally {
      clearTimeout(t);
    }
    const marks = (j.marks ?? {}) as Record<string, unknown>;
    const balances = (j.balances ?? {}) as Record<string, unknown>;
    const floor = (j.valueFloor ?? {}) as Record<string, unknown>;
    const rawOrders = Array.isArray(j.orders) ? (j.orders as Array<Record<string, unknown>>) : [];
    const rawBids = Array.isArray(j.ourBids) ? (j.ourBids as Array<Record<string, unknown>>) : [];
    const num = (v: unknown): number | null => (Number.isFinite(Number(v)) ? Number(v) : null);
    const marksSources = (marks.sources ?? {}) as Record<string, unknown>;
    return {
      fetched: true,
      parity: num(marks.parity),
      paritySource: typeof marks.paritySource === "string" ? marks.paritySource : null,
      steemUsd: num(marks.steemUsd),
      sbdUsd: num(marks.sbdUsd),
      sbdSource: typeof marksSources.sbd === "string" ? marksSources.sbd : null,
      orders: rawOrders
        .map((o) => ({
          orderid: Number(o.orderid),
          amount: num(o.amount) ?? 0,
          price: num(o.price) ?? 0,
          usdIfFilled: num(o.usdIfFilled),
        }))
        .filter((o) => o.orderid > 0 && o.amount > 0 && o.price > 0),
      ordersTotalSteem: rawOrders.reduce((s, o) => s + (num(o.amount) ?? 0), 0),
      bids: rawBids
        .map((b) => ({ orderid: Number(b.orderid), sbd: num(b.sbd) ?? 0, price: num(b.price) ?? 0 }))
        .filter((b) => b.orderid > 0 && b.sbd > 0),
      deployedSteem: num(j.deployedSteem),
      idleSteem: num(j.idleSteem),
      liquidSteem: num(balances.steem),
      liquidSbd: num(balances.sbd),
      valueFloorState: typeof floor.state === "string" ? floor.state : null,
      fillsWindow24h: num(j.fillsWindow24h),
      note: null,
    };
  } catch (e) {
    dead.note = `unmeasured: /api/money (${String((e as Error)?.message ?? e).slice(0, 60)})`;
    return dead;
  }
}

// ── קבלות-המוביל (txids) ─────────────────────────────────────────────

interface MoverReceiptLike {
  at?: string;
  kind?: string;
  /** צורות-אמת בשדה: מערך-קבלות עם txid, או מספר-ספירה בלבד (תיקון-כנות R101c) */
  placed?: Array<{ txid?: string | null }> | number;
  cancelled?: Array<{ txid?: string | null }> | number;
}

function receiptEvidence(): ReceiptEvidence {
  const source = "sovereign/money/history.json (money daemon MoverReceipts — txid לכל cancel/create)";
  const txList = (v: MoverReceiptLike["placed"] | MoverReceiptLike["cancelled"]): string[] =>
    Array.isArray(v) ? v.filter((p) => typeof p?.txid === "string" && p.txid.length >= 40).map((p) => String((p as { txid: string }).txid)) : [];
  try {
    const hist = JSON.parse(fs.readFileSync(RECEIPTS_FILE, "utf8")) as MoverReceiptLike[];
    if (!Array.isArray(hist)) return { total: 0, withTxid: 0, lastAt: null, lastKinds: [], lastTxids: [], source };
    let withTxid = 0;
    for (const r of hist) {
      const tx = txList(r.placed).length + txList(r.cancelled).length > 0;
      if (tx) withTxid += 1;
    }
    const last = hist.slice(-10).reverse();
    return {
      total: hist.length,
      withTxid,
      lastAt: hist.length ? hist[hist.length - 1]?.at ?? null : null,
      lastKinds: last.map((r) => String(r.kind ?? "?")).slice(0, 5),
      lastTxids: last.flatMap((r) => [...txList(r.placed), ...txList(r.cancelled)]).slice(0, 6),
      source,
    };
  } catch {
    return { total: 0, withTxid: 0, lastAt: null, lastKinds: [], lastTxids: [], source: `${source} · unmeasured (קובץ נעדר/פגום)` };
  }
}

// ── החישוב החי ───────────────────────────────────────────────────────

const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const r3 = (n: number): number => Math.round(n * 1e3) / 1e3;

export interface PnlComputation {
  at: string;
  account: string;
  scan: { ok: boolean; savedAt: string | null; maxIndex: number | null };
  house: {
    valueFloorState: string | null;
    idleSteem: number | null;
    liquidSteem: number | null;
    liquidSbd: number | null;
    fillsWindow24h: number | null;
    bidsOpen: number;
  };
  realized: PnlSnapshotEntry["realized"];
  unrealized: PnlSnapshotEntry["unrealized"];
  marks: PnlSnapshotEntry["marks"];
  sources: PnlSnapshotEntry["sources"];
  receipts: ReceiptEvidence;
  fillsLast: PnlSnapshotEntry["fillsLast"];
  tripsLast: LedgerTrip[];
  unmeasured: string[];
}

export async function computePnl(): Promise<PnlComputation> {
  const at = new Date().toISOString();
  const [scan, live, receipts] = await Promise.all([loadFills(), fetchMoneyLive(), receiptEvidence()]);
  const unmeasured: string[] = [];
  if (!scan.ok) unmeasured.push("realized: צ'קפוינט מילויי-השרשרת (pnl-scan.json) נעדר — realized unmeasured");
  if (live.note) unmeasured.push(live.note);

  const { trips, openLots } = fifo(scan.fills);
  const capturedSbd = trips.reduce((s, t) => s + t.capturedSbd, 0);
  const netSteem = scan.fills.reduce((s, f) => s + (f.side === "bought-steem" ? f.steem : -f.steem), 0);
  const netSbd = scan.fills.reduce((s, f) => s + (f.side === "sold-steem" ? f.sbd : -f.sbd), 0);
  const openLongSteem = openLots.reduce((s, l) => s + l.steem, 0);
  const firstFillAt = scan.fills.length ? scan.fills[0]!.at : null;
  const lastFillAt = scan.fills.length ? scan.fills[scan.fills.length - 1]!.at : null;

  const parity = live.parity;
  const sbdUsd = live.sbdUsd;
  const realizedMeasured = scan.ok;
  const usdMeasured = sbdUsd != null;

  // Unrealized — פרמיית-הסולם: מה שהפקודות הפתוחות יתפסו מעל קו-הפאריטה
  let ladderPremiumSbd: number | null = null;
  let ordersBelowParity: number | null = null;
  if (parity != null) {
    ladderPremiumSbd = 0;
    ordersBelowParity = 0;
    for (const o of live.orders) {
      if (o.price >= parity) ladderPremiumSbd += (o.price - parity) * o.amount;
      else ordersBelowParity += 1; // חוק-הרצפה אוסר — אם קיים, זו סטייה שנמדדת
    }
    ladderPremiumSbd = r6(ladderPremiumSbd);
  }
  // Unrealized — מלאי פתוח מסומן לפאריטה (יכול להיות שלילי — זו האמת)
  let openLongMarkSbd: number | null = null;
  if (parity != null) {
    openLongMarkSbd = r6(openLots.reduce((s, l) => s + (parity - l.price) * l.steem, 0));
  }
  const toUsd = (sbd: number | null): number | null =>
    sbd != null && usdMeasured ? Math.round(sbd * (sbdUsd as number) * 1e4) / 1e4 : null;

  return {
    at,
    account: "headcorner",
    scan: { ok: scan.ok, savedAt: scan.savedAt, maxIndex: scan.maxIndex },
    house: {
      valueFloorState: live.valueFloorState,
      idleSteem: live.idleSteem,
      liquidSteem: live.liquidSteem,
      liquidSbd: live.liquidSbd,
      fillsWindow24h: live.fillsWindow24h,
      bidsOpen: live.bids.length,
    },
    realized: {
      measured: realizedMeasured,
      fillsTotal: scan.fills.length,
      trips: trips.length,
      capturedSbd: r6(capturedSbd),
      capturedUsd: toUsd(r6(capturedSbd)),
      netSteem: realizedMeasured ? r3(netSteem) : null,
      netSbd: realizedMeasured ? r6(netSbd) : null,
      openLongSteem: realizedMeasured ? r3(openLongSteem) : null,
      firstFillAt,
      lastFillAt,
      note: realizedMeasured
        ? `FIFO על fill_order אמיתיים מהשרשרת (צ'קפוינט ${scan.savedAt ?? "?"}) · סבב נסגר רק במכירה שסוגרת קנייה; מלאי פתוח אינו רווח`
        : "unmeasured",
    },
    unrealized: {
      measured: parity != null,
      ordersOpen: live.orders.length,
      deployedSteem: live.deployedSteem,
      ladderPremiumSbd,
      ladderPremiumUsd: toUsd(ladderPremiumSbd),
      ordersBelowParity,
      openLongMarkSbd,
      openLongMarkUsd: toUsd(openLongMarkSbd),
      bidsOpenSbd: live.bids.length ? r6(live.bids.reduce((s, b) => s + b.sbd, 0)) : 0,
      note:
        parity != null
          ? `פרמיית-הסולם = Σ(amount×(price−parity)) על פקודות-המכירה הפתוחות מול הפאריטה החיה (${live.paritySource ?? "?"}) · מלאי פתוח מסומן לפאריטה`
          : "unmeasured: פאריטה חיה לא נמדדה",
    },
    marks: {
      parity,
      paritySource: live.paritySource,
      steemUsd: live.steemUsd,
      sbdUsd,
      sbdSource: live.sbdSource,
    },
    sources: {
      fills: `chain:fill_order (steem get_account_history) via sovereign/money/pnl-scan.json checkpoint savedAt=${scan.savedAt ?? "unmeasured"} maxIndex=${scan.maxIndex ?? "unmeasured"} — כל מילוי נושא אינדקס-ראיה (idx)`,
      ordersAndMarks: `live /api/money → condenser_api.get_open_orders + get_order_book (כל פקודה נושאת orderid; פאריטה: ${live.paritySource ?? "unmeasured"})`,
      receipts: receipts.source,
      usdConversion: usdMeasured
        ? `SBD→USD בשער-היום בלבד: ${sbdUsd} (${live.sbdSource ?? "?"}) — שער היסטורי לא נמדד כאן`
        : "unmeasured — אין שער SBD חי; המרה לא בוצעה",
    },
    receipts,
    fillsLast: scan.fills.slice(-5).map((f) => ({ idx: f.idx, at: f.at, side: f.side, price: f.price, steem: f.steem, sbd: f.sbd })),
    tripsLast: trips.slice(-5),
    unmeasured,
  };
}

// ── פנקס-התמונות: append-only, hash-chained (כמו יומן-ההחלטות) ────────

// r147-d: הקנון חי ב-src/lib/weave/hash-chain.ts (hashChainEntry) — מנגנון אחד.
function hashEntry(entry: Omit<PnlSnapshotEntry, "entryHash">): string {
  return hashChainEntry(entry);
}

export function readSnapshotFile(): SnapshotFile {
  try {
    const j = JSON.parse(fs.readFileSync(SNAPSHOTS_FILE, "utf8")) as SnapshotFile;
    if (j && j.format === "weave-pnl-snapshots-v1" && Array.isArray(j.entries)) return j;
  } catch {}
  return { format: "weave-pnl-snapshots-v1", savedAt: new Date().toISOString(), entries: [] };
}

export function verifySnapshots(): SnapshotChainState {
  // r147-d: האימות מהגרעין-המשותף (verifyHashChain) — אותו-חוק, גוף-אחד
  const entries = readSnapshotFile().entries;
  const v = verifyHashChain(entries as unknown as Array<Record<string, unknown>>);
  if (!v.ok) return { entries: v.entries, ok: false, brokenAt: v.brokenAt, lastAt: null };
  return { entries: v.entries, ok: true, brokenAt: null, lastAt: entries.length ? entries[entries.length - 1]!.at : null };
}

export function appendSnapshot(pnl: PnlComputation): { appended: boolean; entry: PnlSnapshotEntry } {
  const file = readSnapshotFile();
  const last = file.entries[file.entries.length - 1] ?? null;
  const prevHash = last?.entryHash ?? "GENESIS";
  const withoutHash: Omit<PnlSnapshotEntry, "entryHash"> = {
    seq: (last?.seq ?? 0) + 1,
    at: pnl.at,
    account: pnl.account,
    realized: pnl.realized,
    unrealized: pnl.unrealized,
    marks: pnl.marks,
    sources: pnl.sources,
    receipts: {
      total: pnl.receipts.total,
      withTxid: pnl.receipts.withTxid,
      lastAt: pnl.receipts.lastAt,
      lastKinds: pnl.receipts.lastKinds,
      lastTxids: pnl.receipts.lastTxids,
    },
    fillsLast: pnl.fillsLast,
    prevHash,
  };
  const entry: PnlSnapshotEntry = { ...withoutHash, entryHash: hashEntry(withoutHash) };
  file.entries.push(entry);
  file.savedAt = pnl.at;
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  const tmp = `${SNAPSHOTS_FILE}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, SNAPSHOTS_FILE);
  return { appended: true, entry };
}

/** תמונה רק אם האחרונה ישנה מהמרווח — או force. מחזיר גם את האחרונה הקיימת. */
export function snapshotIfStale(pnl: PnlComputation, force: boolean): { appended: boolean; entry: PnlSnapshotEntry } {
  const file = readSnapshotFile();
  const last = file.entries[file.entries.length - 1] ?? null;
  const age = last ? Date.now() - Date.parse(last.at) : Infinity;
  if (!force && last && age < SNAPSHOT_MIN_INTERVAL_MS) return { appended: false, entry: last };
  return appendSnapshot(pnl);
}
