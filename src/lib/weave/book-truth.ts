// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Book-Truth — חוק אמת-הספרים (r145-a · SIM→REAL separation)
//
// השורש (נמדד ב-r144-c, סומן לתיקון-אמת ב-93f9b7a): ספר-הזירה הריבונית
// (sovereign-exchange) הוא hash-chained מקומי ב-Prisma SQLite — לא
// שרשרת-חוץ. הוא מוצג לצד אמת-שרשרת עם תווית חצי-כנה ("יחידות פנימיות")
// ונספר איתה. החוק מעתה: לכל ספר-כספים בבית יש מחלקת-אמת מפורשת —
//   · REAL  — השרשרת היא השופטת (פקודות/מילויים/txid על שרשרת חיה)
//   · SIM   — ספר-תביעות פנימי (hash-chained מקומי) — חשבונאות אמיתית
//             של הבית, אך אינו נספר כאמת-שרשרת ואינו יכול להיות מוצג
//             כפעילות חוץ.
// שום תצוגה/API לא יכול עוד להציג פעילות-סימולציה כאמת: המדינות חשופות
// כאן עם מונים (simBooks/realBooks) — אפס טענה בלי מדידה.
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import { db } from "@/lib/db";

const HOME = "/home/z/my-project";

export type TruthClass = "REAL" | "SIM";

export interface BookTruthRow {
  id: string;
  labelHe: string;
  /** מקור-האמת של הספר — מה שופט את המספרים שלו */
  source: string;
  truthClass: TruthClass;
  /** מונה-אירועים נמדד (null = לא נמדד בקריאה הזאת — כנות, לא אפס) */
  events: number | null;
}

export interface BookTruth {
  at: string;
  realBooks: BookTruthRow[];
  simBooks: BookTruthRow[];
  counts: {
    realBooks: number;
    simBooks: number;
    realEvents: number | null;
    simEvents: number | null;
  };
  note: string;
}

function readFileInt(path: string, pick: (j: any) => number | null): number | null {
  try {
    const j = JSON.parse(fs.readFileSync(path, "utf8"));
    const n = pick(j);
    return typeof n === "number" && Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * מדידת אמת-הספרים — קריאה בלבד (קבצים + DB מקומי), אפס רשת, אפס מפתחות.
 * כל מונה נמדד חי בזמן הקריאה; מה שלא נמדד חוזר null — לא אפס.
 */
export async function bookTruth(): Promise<BookTruth> {
  // ── REAL — השרשרת השופטת ────────────────────────────────────────────
  // 1. סולם STEEM — פקודות ומילויים חיים על Steem (מקור: condenser_api
  //    get_open_orders/get_accounts · fill_order בצ'קפוינט pnl-scan).
  const steemFills = readFileInt(`${HOME}/sovereign/money/pnl-scan.json`, (j) =>
    Array.isArray(j?.fills) ? j.fills.length : null,
  );
  // 2. פנקס-ה-PnL — נגזר כולו מקבלות-שרשרת (fill_order idx + orderid + txid),
  //    תמונות-מצב append-only hash-chained.
  const pnlSnapshots = readFileInt(`${HOME}/sovereign/economy/pnl-snapshots.json`, (j) =>
    Array.isArray(j?.entries) ? j.entries.length : null,
  );
  // 3. קבלות-המוביל — REAL מונה רק קבלות-שרשרת (לפחות txid אחד של
  //    cancel/create אמיתי). הספר עצמו מכיל גם רישומי-בית (SAOS-REWARD,
  //    FLEET-COMPOUND — פעילות-זירה פנימית) והם אינם נספרים כאמת-שרשרת:
  //    החוק המדויק — מה שאין עליו txid אינו ראיה על-שרשרת.
  const moverReceipts = readFileInt(`${HOME}/sovereign/money/history.json`, (j) =>
    Array.isArray(j)
      ? j.filter((r) =>
          ["placed", "cancelled"].some((k) =>
            Array.isArray(r?.[k]) && (r[k] as Array<{ txid?: string }>).some((p) => typeof p?.txid === "string" && p.txid.length >= 40),
          ),
        ).length
      : null,
  );
  // 4. שרשרת SAOS-LIVE (קרנל-SAOS) — המצב המקופל מהצומת; seen = כל האופים
  //    שהקיפול אימת (מונה-מזהים עולה).
  const saosOps = readFileInt(`${HOME}/sovereign/saos-live-state.json`, (j) =>
    j?.seen && typeof j.seen === "object" ? Object.keys(j.seen).length : null,
  );

  const realBooks: BookTruthRow[] = [
    {
      id: "steem-ladder",
      labelHe: "סולם המוביל על שרשרת-Steem (פקודות פתוחות · מילויי fill_order)",
      source: "condenser_api.get_open_orders/get_accounts · pnl-scan checkpoint (api.steemit.com)",
      truthClass: "REAL",
      events: steemFills,
    },
    {
      id: "pnl-ledger",
      labelHe: "פנקס-PnL אמיתי — realized/unrealized מקבלות-שרשרת (תמונות hash-chained)",
      source: "sovereign/economy/pnl-snapshots.json ← fill_order idx + orderid + txid",
      truthClass: "REAL",
      events: pnlSnapshots,
    },
    {
      id: "mover-receipts",
      labelHe: "קבלות-מוביל הכסף (txid לכל cancel/create על השרשרת)",
      source: "sovereign/money/history.json (MoverReceipts · MoverReceipt kind)",
      truthClass: "REAL",
      events: moverReceipts,
    },
    {
      id: "saos-live-kernel",
      labelHe: "שרשרת SAOS-LIVE (קרנל-SAOS — המצב המקופל מהצומת, נטול-מפתחות)",
      source: "sovereign/saos-live-state.json ← saos-rail foldLiveState",
      truthClass: "REAL",
      events: saosOps,
    },
  ];

  // ── SIM — ספרי-תביעות פנימיים ───────────────────────────────────────
  // הזירה הריבונית: ExchangeEvent/ExchangeAccount/ExchangePool — ספר
  // hash-chained מקומי (keccak prevHash‖seq‖…) שנזרע מהון-אוצר נמדד.
  // חשבונאות-בית אמיתית, אך לא שרשרת-חוץ — מחלקת-SIM לחשבון-אמת.
  let simEvents: number | null = null;
  try {
    simEvents = await db.exchangeEvent.count();
  } catch {
    simEvents = null; // כנות: ספר שלא נקרא אינו אפס
  }
  const simBooks: BookTruthRow[] = [
    {
      id: "arena-book",
      labelHe:
        "ספר-הזירה הריבונית (WSTEEM/WSBD/USDS/SAOS — תביעות פנימיות, hash-chained מקומי ב-Prisma SQLite). " +
        "מגובה מהון-אוצר נמדד בג'נזיס — אך אינו שרשרת-חוץ ואינו נספר כאמת-שרשרת",
      source: "db ExchangeEvent/ExchangeAccount/ExchangePool (keccak prevHash‖seq‖kind‖member‖payload)",
      truthClass: "SIM",
      events: simEvents,
    },
  ];

  const realEvents = realBooks.reduce<number | null>(
    (acc, b) => (acc == null || b.events == null ? acc : acc + b.events),
    0,
  );

  return {
    at: new Date().toISOString(),
    realBooks,
    simBooks,
    counts: {
      realBooks: realBooks.length,
      simBooks: simBooks.length,
      realEvents,
      simEvents,
    },
    note:
      "חוק אמת-הספרים (r145-a): ספרי-REAL נשפטים על-ידי שרשרת חיה (פקודות/מילויים/txid) · " +
      "ספרי-SIM הם חשבונאות-תביעות פנימית של הבית — אמיתיים כספר, אך אינם פעילות-חוץ " +
      "ואינם נספרים עמה. שום תצוגה לא רשאית להציג SIM כ-REAL.",
  };
}
